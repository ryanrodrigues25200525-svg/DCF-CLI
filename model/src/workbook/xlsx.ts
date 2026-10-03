import { execFile as execFileCb, spawnSync } from "node:child_process";
import { accessSync, constants as fsConstants, existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCb);

export interface CellEdit {
  sheet: string;
  cell: string;
  value?: string | number | boolean | null;
  formula?: string;
}

export interface AppliedEdit extends CellEdit {
  priorValue: string | number | boolean | null;
  priorFormula: string | null;
}

export interface WorkbookInspection {
  sheets: string[];
  formulaCount: number;
  /** e.g. ["DCF Model!Q94=#DIV/0!"] */
  cachedErrorCells: string[];
  hasInputRequiredSheet: boolean;
  /** cached B3 value if sheet present */
  inputRequiredStatus: string | null;
  dataReviewRows: number;
}

const CELL_RE = /^[A-Z]{1,3}[1-9][0-9]{0,6}$/i;

// ---------------------------------------------------------------- engines ---

function isExecutableFile(p: string): boolean {
  try {
    accessSync(p, fsConstants.F_OK | fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Executable names to try for a base command, honoring PATHEXT on Windows. */
function executableNames(base: string): string[] {
  if (process.platform !== "win32") return [base];
  const extensions = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((ext) => ext.trim())
    .filter(Boolean)
    .map((ext) => (ext.startsWith(".") ? ext : `.${ext}`));
  return Array.from(new Set([base, ...extensions.map((ext) => `${base}${ext}`)]));
}

/**
 * Resolve `base` on `PATH` without shelling out to `which`/`where`.
 * Returns the first executable candidate, or null when PATH is unset or empty.
 */
function findExecutableOnPath(base: string): string | null {
  const pathEnv = process.env.PATH;
  if (!pathEnv) return null;
  const separator = process.platform === "win32" ? ";" : ":";
  for (const dir of pathEnv.split(separator)) {
    if (!dir) continue;
    for (const name of executableNames(base)) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate) && isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
}

function canImportOpenpyxl(python: string): boolean {
  try {
    const r = spawnSync(python, ["-c", "import openpyxl"], {
      stdio: "ignore",
      timeout: 60_000,
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

/** Walk up from start dirs looking for <dir>/backend/.venv/<bin>/python. */
function findRepoVenvPython(): string | null {
  const bin = process.platform === "win32" ? "Scripts" : "bin";
  const exe = process.platform === "win32" ? "python.exe" : "python";
  const startDirs: string[] = [process.cwd()];
  try {
    // file-based fallback: model/src/workbook -> repo root is 3 levels up.
    // fileURLToPath (not URL.pathname) so spaces like "Projects Archived" survive.
    startDirs.push(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."));
  } catch {
    // ignore
  }
  const seen = new Set<string>();
  for (const start of startDirs) {
    let dir = path.resolve(start);
    for (let i = 0; i < 8; i++) {
      if (seen.has(dir)) break;
      seen.add(dir);
      const candidate = path.join(dir, "backend", ".venv", bin, exe);
      if (existsSync(candidate) && isExecutableFile(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

/**
 * backend/.venv/bin/python (or Scripts/python.exe on win32), else the first
 * openpyxl-capable PATH interpreter in order `python3`, `python` on POSIX and
 * `python`, `python3`, `py` on Windows.
 */
export function findBackendPython(): string | null {
  const venv = findRepoVenvPython();
  if (venv !== null && canImportOpenpyxl(venv)) return venv;
  // venv binary exists but openpyxl missing -> fall through to a PATH interpreter.
  const candidates = process.platform === "win32"
    ? ["python", "python3", "py"]
    : ["python3", "python"];
  for (const candidate of candidates) {
    if (canImportOpenpyxl(candidate)) return candidate;
  }
  return null;
}

function sofficeWorks(candidate: string): boolean {
  try {
    const r = spawnSync(candidate, ['--headless', '--version'], {
      stdio: 'ignore',
      timeout: 60_000,
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

/** Uses `SOFFICE_PATH`, a `PATH` lookup, then common install paths. */
export function findSoffice(): string | null {
  const candidates: string[] = [];
  const explicit = process.env.SOFFICE_PATH?.trim();
  if (explicit) candidates.push(explicit);
  const onPath = findExecutableOnPath("soffice");
  if (onPath) candidates.push(onPath);
  if (process.platform === "win32") {
    candidates.push(
      "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
      "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
    );
  } else {
    candidates.push(
      "/opt/homebrew/bin/soffice",
      "/Applications/LibreOffice.app/Contents/MacOS/soffice",
      "/usr/bin/soffice",
      "/usr/local/bin/soffice",
    );
  }
  for (const c of candidates) {
    if (existsSync(c) && isExecutableFile(c) && sofficeWorks(c)) return c;
  }
  return null;
}

export function checkEngines(): { python: string | null; soffice: string | null } {
  return { python: findBackendPython(), soffice: findSoffice() };
}

// ---------------------------------------------------------------- python ----

const INSPECT_SCRIPT = `
import json, sys
import openpyxl

src = sys.argv[1]
wb = openpyxl.load_workbook(src, data_only=False)
sheets = list(wb.sheetnames)
formula_count = 0
input_b3_formula = None
data_review_rows = 0
for ws in wb.worksheets:
    for row in ws.iter_rows():
        for c in row:
            v = c.value
            if isinstance(v, str) and v.startswith("="):
                formula_count += 1
if "Input Required" in wb.sheetnames:
    try:
        input_b3_formula = wb["Input Required"]["B3"].value
    except Exception:
        input_b3_formula = None
if "Data Review" in wb.sheetnames:
    try:
        ws = wb["Data Review"]
        n = 0
        for row in ws.iter_rows():
            for c in row:
                if c.value is not None and not (isinstance(c.value, str) and c.value == ""):
                    n += 1
                    break
        data_review_rows = n
    except Exception:
        data_review_rows = 0
wb.close()

wb2 = openpyxl.load_workbook(src, data_only=True, read_only=True)
errors = []
input_b3_cached = None
for ws in wb2.worksheets:
    for row in ws.iter_rows():
        for c in row:
            v = c.value
            if isinstance(v, str) and v.startswith("#"):
                if len(errors) < 200:
                    errors.append(f"{ws.title}!{c.coordinate}={v}")
    if ws.title == "Input Required":
        try:
            input_b3_cached = ws["B3"].value
        except Exception:
            input_b3_cached = None
wb2.close()

has_input = "Input Required" in sheets
if has_input:
    status = None if input_b3_cached is None else str(input_b3_cached)
else:
    status = None

print(json.dumps({
    "sheets": sheets,
    "formulaCount": formula_count,
    "cachedErrorCells": errors,
    "hasInputRequiredSheet": has_input,
    "inputRequiredStatus": status,
    "dataReviewRows": data_review_rows,
}))
`;

const APPLY_SCRIPT = `
import json, os, re, sys
import openpyxl

CELL_RE = re.compile(r"^[A-Z]{1,3}[1-9][0-9]{0,6}$", re.IGNORECASE)

src = sys.argv[1]
dest = sys.argv[2]
edits = json.loads(os.environ["DCF_EDITS"])

wb_data = openpyxl.load_workbook(src, data_only=True)
wb = openpyxl.load_workbook(src, data_only=False)

out = []
for i, e in enumerate(edits):
    sheet = e.get("sheet")
    cell = e.get("cell")
    has_value = "value" in e and e.get("value") is not None or (isinstance(e.get("value"), bool)) or e.get("value") is None and "value" in e
    # exact "exactly one of value/formula" semantics: key presence decides
    has_value = "value" in e
    has_formula = "formula" in e and e.get("formula") is not None
    if not isinstance(sheet, str) or sheet not in wb.sheetnames:
        raise ValueError(f"edit {i}: unknown sheet {sheet!r}")
    if not isinstance(cell, str) or not CELL_RE.match(cell):
        raise ValueError(f"edit {i}: invalid cell address {cell!r}")
    if has_value == has_formula:
        raise ValueError(f"edit {i} ({sheet}!{cell}): exactly one of value/formula must be set")
    if has_formula:
        f = e.get("formula")
        if not isinstance(f, str) or not f.startswith("="):
            raise ValueError(f"edit {i} ({sheet}!{cell}): formula must start with '='")
        if len(f) < 2:
            raise ValueError(f"edit {i} ({sheet}!{cell}): formula must not be bare '='")
    if has_value:
        v = e.get("value")
        if v is not None and not isinstance(v, (str, int, float, bool)):
            raise ValueError(f"edit {i} ({sheet}!{cell}): value must be string|number|boolean|null")
    try:
        prior_value = wb_data[sheet][cell].value
    except Exception as ex:
        raise ValueError(f"edit {i}: cannot read prior value at {sheet}!{cell}: {ex}")
    cur = wb[sheet][cell].value
    prior_formula = cur if (isinstance(cur, str) and cur.startswith("=")) else None
    target = wb[sheet][cell]
    if has_formula:
        target.value = e.get("formula")
    else:
        target.value = e.get("value")
    out.append({
        "sheet": sheet,
        "cell": cell.upper(),
        "value": e.get("value") if has_value else None,
        "formula": e.get("formula") if has_formula else None,
        "priorValue": prior_value,
        "priorFormula": prior_formula,
    })

wb.save(dest)
print(json.dumps(out))
`;

const READ_STATES_SCRIPT = `
import json, re, sys
import openpyxl

CELL_RE = re.compile(r"^[A-Z]{1,3}[1-9][0-9]{0,6}$", re.IGNORECASE)

src = sys.argv[1]
refs = json.loads(sys.argv[2])

wb_data = openpyxl.load_workbook(src, data_only=True)
wb = openpyxl.load_workbook(src, data_only=False)

out = []
for i, ref in enumerate(refs):
    sheet = ref.get("sheet")
    cell = ref.get("cell")
    if not isinstance(sheet, str) or sheet not in wb.sheetnames:
        raise ValueError(f"ref {i}: unknown sheet {sheet!r}")
    if not isinstance(cell, str) or not CELL_RE.match(cell):
        raise ValueError(f"ref {i}: invalid cell address {cell!r}")
    try:
        prior_value = wb_data[sheet][cell].value
    except Exception as ex:
        raise ValueError(f"ref {i}: cannot read prior value at {sheet}!{cell}: {ex}")
    cur = wb[sheet][cell].value
    prior_formula = cur if (isinstance(cur, str) and cur.startswith("=")) else None
    out.append({"sheet": sheet, "cell": cell.upper(), "priorValue": prior_value, "priorFormula": prior_formula})

print(json.dumps(out))
`;

/** Validate edits in TS before spawning python (mirrors script rules). */
function validateCellEdits(edits: CellEdit[]): void {
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i] as CellEdit;
    if (typeof e.sheet !== "string" || e.sheet.length === 0) {
      throw new Error(`edit ${i}: sheet must be a non-empty string`);
    }
    if (typeof e.cell !== "string" || !CELL_RE.test(e.cell)) {
      throw new Error(`edit ${i}: invalid cell address ${JSON.stringify(e.cell)}`);
    }
    const hasValue = Object.prototype.hasOwnProperty.call(e, "value") && e.value !== undefined;
    // Treat explicit undefined value key as unset
    const hasValueEffective = hasValue && e.value !== undefined;
    const hasFormula = e.formula !== undefined && e.formula !== null;
    if (hasValueEffective === hasFormula) {
      throw new Error(`edit ${i} (${e.sheet}!${e.cell}): exactly one of value/formula must be set`);
    }
    if (hasFormula) {
      const f = e.formula as string;
      if (typeof f !== "string" || !f.startsWith("=") || f.length < 2) {
        throw new Error(`edit ${i} (${e.sheet}!${e.cell}): formula must start with '='`);
      }
    }
    if (hasValueEffective) {
      const v = e.value;
      if (
        v !== null &&
        v !== undefined &&
        typeof v !== "string" &&
        typeof v !== "number" &&
        typeof v !== "boolean"
      ) {
        throw new Error(`edit ${i} (${e.sheet}!${e.cell}): value must be string|number|boolean|null`);
      }
    }
  }
}

function isInspection(o: unknown): o is WorkbookInspection {
  if (typeof o !== "object" || o === null) return false;
  const r = o as Record<string, unknown>;
  return (
    Array.isArray(r["sheets"]) &&
    typeof r["formulaCount"] === "number" &&
    Array.isArray(r["cachedErrorCells"]) &&
    typeof r["hasInputRequiredSheet"] === "boolean" &&
    (typeof r["inputRequiredStatus"] === "string" || r["inputRequiredStatus"] === null) &&
    typeof r["dataReviewRows"] === "number"
  );
}

export async function inspectWorkbook(python: string, workbookPath: string): Promise<WorkbookInspection> {
  let stdout: string;
  try {
    const res = await execFileAsync(python, ["-c", INSPECT_SCRIPT, workbookPath], {
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    stdout = res.stdout;
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const snippet = String(e.stderr ?? e.message ?? err).slice(-2000);
    throw new Error(`inspectWorkbook failed for ${workbookPath}: ${snippet}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim().split("\n").pop() as string);
  } catch {
    throw new Error(`inspectWorkbook: could not parse python output for ${workbookPath}`);
  }
  if (!isInspection(parsed)) throw new Error(`inspectWorkbook: unexpected output shape for ${workbookPath}`);
  return parsed;
}

export interface CellState {
  sheet: string;
  cell: string;
  priorValue: string | number | boolean | null;
  priorFormula: string | null;
}

/** Read-only prior value/formula for proposal creation. Never modifies the file. */
export async function readCellStates(
  python: string,
  workbookPath: string,
  refs: Array<{ sheet: string; cell: string }>,
): Promise<CellState[]> {
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i] as { sheet: string; cell: string };
    if (typeof ref.sheet !== 'string' || ref.sheet.length === 0) {
      throw new Error(`ref ${i}: sheet must be a non-empty string`);
    }
    if (typeof ref.cell !== 'string' || !CELL_RE.test(ref.cell)) {
      throw new Error(`ref ${i}: invalid cell address ${JSON.stringify(ref.cell)}`);
    }
  }
  let stdout: string;
  try {
    const res = await execFileAsync(python, ['-c', READ_STATES_SCRIPT, workbookPath, JSON.stringify(refs)], {
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    stdout = res.stdout;
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    throw new Error(`readCellStates failed for ${workbookPath}: ${String(e.stderr ?? e.message ?? err).slice(-2000)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim().split('\n').pop() as string);
  } catch {
    throw new Error(`readCellStates: could not parse python output for ${workbookPath}`);
  }
  if (!Array.isArray(parsed)) throw new Error('readCellStates: unexpected output shape');
  return parsed.map((row) => {
    const r = row as Record<string, unknown>;
    const priorValue = r['priorValue'];
    return {
      sheet: String(r['sheet']),
      cell: String(r['cell']),
      priorValue: typeof priorValue === 'string' || typeof priorValue === 'number' || typeof priorValue === 'boolean'
        ? priorValue
        : null,
      priorFormula: typeof r['priorFormula'] === 'string' ? (r['priorFormula'] as string) : null,
    };
  });
}

export async function applyCellEdits(  python: string,
  sourcePath: string,
  destPath: string,
  edits: CellEdit[],
): Promise<AppliedEdit[]> {
  validateCellEdits(edits);
  if (sourcePath === destPath) {
    throw new Error("applyCellEdits: sourcePath and destPath must differ (never modify the source)");
  }
  // Normalise payload: drop explicit undefined keys so python key-presence checks work.
  const payload = edits.map((e) => {
    const o: Record<string, unknown> = { sheet: e.sheet, cell: e.cell };
    if (e.value !== undefined) o["value"] = e.value;
    if (e.formula !== undefined && e.formula !== null) o["formula"] = e.formula;
    return o;
  });
  let stdout: string;
  try {
    const res = await execFileAsync(python, ["-c", APPLY_SCRIPT, sourcePath, destPath], {
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, DCF_EDITS: JSON.stringify(payload) },
    });
    stdout = res.stdout;
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const snippet = String(e.stderr ?? e.message ?? err).slice(-2000);
    throw new Error(`applyCellEdits failed (${sourcePath} -> ${destPath}): ${snippet}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim().split("\n").pop() as string);
  } catch {
    throw new Error("applyCellEdits: could not parse python output");
  }
  if (!Array.isArray(parsed)) throw new Error("applyCellEdits: unexpected output shape");
  return parsed.map((row) => {
    const r = row as Record<string, unknown>;
    const edit: AppliedEdit = {
      sheet: String(r["sheet"]),
      cell: String(r["cell"]),
      priorValue: (r["priorValue"] === undefined ? null : r["priorValue"]) as
        | string
        | number
        | boolean
        | null,
      priorFormula: (r["priorFormula"] as string | null) ?? null,
    };
    if ("formula" in r && r["formula"] !== undefined && r["formula"] !== null) {
      edit.formula = String(r["formula"]);
    } else {
      const v = r["value"];
      edit.value =
        v === null || v === undefined
          ? null
          : (v as string | number | boolean);
    }
    if (typeof edit.priorValue !== "string" && typeof edit.priorValue !== "number" &&
      typeof edit.priorValue !== "boolean" && edit.priorValue !== null) {
      edit.priorValue = null;
    }
    if (typeof edit.priorFormula !== "string") edit.priorFormula = null;
    return edit;
  });
}

export async function recalculateWorkbook(soffice: string, workbookPath: string): Promise<void> {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dcf-recalc-"));
  const profileDir = path.join(tmpRoot, "profile");
  await fs.mkdir(profileDir, { recursive: true });
  try {
    let stderr = "";
    try {
      await execFileAsync(
        soffice,
        [
          `-env:UserInstallation=file://${profileDir}`,
          "--headless",
          "--convert-to",
          "xlsx",
          "--outdir",
          tmpRoot,
          workbookPath,
        ],
        { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 },
      );
    } catch (err) {
      const e = err as { stderr?: string; message?: string };
      stderr = String(e.stderr ?? e.message ?? err);
      throw new Error(`soffice recalculation failed for ${workbookPath}: ${stderr.slice(-2000)}`);
    }
    void stderr;
    const base = path.basename(workbookPath, path.extname(workbookPath)) + ".xlsx";
    const converted = path.join(tmpRoot, base);
    if (!existsSync(converted)) {
      throw new Error(`soffice recalculation produced no output (expected ${base}) for ${workbookPath}`);
    }
    // Atomic replace: temp copy in the same dir + rename.
    const dir = path.dirname(workbookPath);
    const tmpDest = path.join(dir, `.${path.basename(workbookPath)}.recalc-${process.pid}.tmp`);
    await fs.copyFile(converted, tmpDest);
    await fs.rename(tmpDest, workbookPath);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
}

export function newErrorCells(before: WorkbookInspection, after: WorkbookInspection): string[] {
  const seen = new Set(before.cachedErrorCells);
  return after.cachedErrorCells.filter((c) => !seen.has(c));
}

// ------------------------------------------------------- revision diff ----

export type WorkbookCellChangeKind = 'formula' | 'value' | 'added' | 'removed';

export interface WorkbookCellChange {
  sheet: string;
  cell: string;
  kind: WorkbookCellChangeKind;
  beforeFormula: string | null;
  afterFormula: string | null;
  beforeValue: string | number | boolean | null;
  afterValue: string | number | boolean | null;
}

export interface WorkbookDiff {
  beforeSheets: string[];
  afterSheets: string[];
  addedSheets: string[];
  removedSheets: string[];
  /** Total cell changes across both workbooks (before paging). */
  totalChanges: number;
  /** True when the change list was capped during collection. */
  truncated: boolean;
  changes: WorkbookCellChange[];
  offset: number;
  limit: number;
}

/** Hard cap on collected cell changes; paging slices below this. */
export const WORKBOOK_DIFF_HARD_CAP = 20000;
export const WORKBOOK_DIFF_DEFAULT_LIMIT = 100;
export const WORKBOOK_DIFF_MAX_LIMIT = 500;

const DIFF_SCRIPT = `
import datetime
import json
import sys
import openpyxl

HARD_CAP = int(sys.argv[3]) if len(sys.argv) > 3 else 20000

def scalar(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (datetime.datetime, datetime.date)):
        return value.isoformat()
    return str(value)

def tag(value):
    if isinstance(value, bool):
        return ('b', value)
    if isinstance(value, (int, float)):
        return ('n', float(value))
    return ('o', scalar(value))

def snapshot(path):
    wb_formulas = openpyxl.load_workbook(path, data_only=False, read_only=True)
    wb_cached = openpyxl.load_workbook(path, data_only=True, read_only=True)
    cells = {}
    try:
        for ws in wb_formulas.worksheets:
            try:
                cached_ws = wb_cached[ws.title]
            except KeyError:
                cached_ws = None
            for row in ws.iter_rows():
                for c in row:
                    raw = c.value
                    formula = raw if (isinstance(raw, str) and raw.startswith('=')) else None
                    if formula is not None:
                        try:
                            cached = cached_ws[c.coordinate].value if cached_ws is not None else None
                        except Exception:
                            cached = None
                        value = scalar(cached)
                    else:
                        value = scalar(raw)
                    if formula is None and value is None:
                        continue
                    cells[(ws.title, c.coordinate)] = (formula, tag(value), value)
    finally:
        try:
            wb_formulas.close()
        except Exception:
            pass
        try:
            wb_cached.close()
        except Exception:
            pass
    return [ws.title for ws in wb_formulas.worksheets], cells

before_sheets, before_cells = snapshot(sys.argv[1])
after_sheets, after_cells = snapshot(sys.argv[2])
added_sheets = sorted(set(after_sheets) - set(before_sheets))
removed_sheets = sorted(set(before_sheets) - set(after_sheets))

changes = []
truncated = False
for key in sorted(set(before_cells) | set(after_cells)):
    sheet, cell = key
    if key not in before_cells:
        formula, _, value = after_cells[key]
        changes.append({'sheet': sheet, 'cell': cell, 'kind': 'added',
                        'beforeFormula': None, 'afterFormula': formula,
                        'beforeValue': None, 'afterValue': value})
    elif key not in after_cells:
        formula, _, value = before_cells[key]
        changes.append({'sheet': sheet, 'cell': cell, 'kind': 'removed',
                        'beforeFormula': formula, 'afterFormula': None,
                        'beforeValue': value, 'afterValue': None})
    else:
        before_formula, before_tag, before_value = before_cells[key]
        after_formula, after_tag, after_value = after_cells[key]
        if before_formula != after_formula:
            changes.append({'sheet': sheet, 'cell': cell, 'kind': 'formula',
                            'beforeFormula': before_formula, 'afterFormula': after_formula,
                            'beforeValue': before_value, 'afterValue': after_value})
        elif before_tag != after_tag:
            changes.append({'sheet': sheet, 'cell': cell, 'kind': 'value',
                            'beforeFormula': before_formula, 'afterFormula': after_formula,
                            'beforeValue': before_value, 'afterValue': after_value})
    if len(changes) >= HARD_CAP:
        truncated = True
        break

print(json.dumps({
    'beforeSheets': before_sheets,
    'afterSheets': after_sheets,
    'addedSheets': added_sheets,
    'removedSheets': removed_sheets,
    'totalChanges': len(changes),
    'truncated': truncated,
    'changes': changes,
}))
`;

function normalizeDiffScalar(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}

function isDiffChange(o: unknown): o is WorkbookCellChange {
  if (typeof o !== 'object' || o === null) return false;
  const r = o as Record<string, unknown>;
  return typeof r['sheet'] === 'string' && typeof r['cell'] === 'string'
    && (r['kind'] === 'formula' || r['kind'] === 'value' || r['kind'] === 'added' || r['kind'] === 'removed');
}

/**
 * Deterministic, read-only cell comparison of two workbook files. Compares
 * live formulas plus cached values (so recalculation-only shifts appear as
 * value changes); blank cells are skipped. Never modifies either file.
 * Output is bounded: collection caps at WORKBOOK_DIFF_HARD_CAP and callers
 * page with offset/limit (clamped to WORKBOOK_DIFF_MAX_LIMIT).
 */
export async function diffWorkbookCells(
  python: string,
  beforePath: string,
  afterPath: string,
  opts?: { offset?: number; limit?: number },
): Promise<WorkbookDiff> {
  const offset = opts?.offset === undefined ? 0 : Math.floor(opts.offset);
  const limit = opts?.limit === undefined ? WORKBOOK_DIFF_DEFAULT_LIMIT : Math.floor(opts.limit);
  if (!Number.isInteger(offset) || offset < 0) throw new Error('diff offset must be an integer >= 0.');
  if (!Number.isInteger(limit) || limit < 1 || limit > WORKBOOK_DIFF_MAX_LIMIT) {
    throw new Error(`diff limit must be an integer between 1 and ${WORKBOOK_DIFF_MAX_LIMIT}.`);
  }
  let stdout: string;
  try {
    const res = await execFileAsync(
      python,
      ['-c', DIFF_SCRIPT, beforePath, afterPath, String(WORKBOOK_DIFF_HARD_CAP)],
      {timeout: 180_000, maxBuffer: 64 * 1024 * 1024},
    );
    stdout = res.stdout;
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    throw new Error(`diffWorkbookCells failed (${beforePath} vs ${afterPath}): ${String(e.stderr ?? e.message ?? err).slice(-2000)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim().split('\n').pop() as string);
  } catch {
    throw new Error('diffWorkbookCells: could not parse python output');
  }
  const r = parsed as Record<string, unknown>;
  if (!r || !Array.isArray(r['changes']) || !Array.isArray(r['beforeSheets']) || !Array.isArray(r['afterSheets'])) {
    throw new Error('diffWorkbookCells: unexpected output shape');
  }
  const all = (r['changes'] as unknown[]).filter(isDiffChange).map((c) => ({
    ...c,
    beforeFormula: typeof c.beforeFormula === 'string' ? c.beforeFormula : null,
    afterFormula: typeof c.afterFormula === 'string' ? c.afterFormula : null,
    beforeValue: normalizeDiffScalar(c.beforeValue),
    afterValue: normalizeDiffScalar(c.afterValue),
  }));
  return {
    beforeSheets: (r['beforeSheets'] as unknown[]).map(String),
    afterSheets: (r['afterSheets'] as unknown[]).map(String),
    addedSheets: Array.isArray(r['addedSheets']) ? (r['addedSheets'] as unknown[]).map(String) : [],
    removedSheets: Array.isArray(r['removedSheets']) ? (r['removedSheets'] as unknown[]).map(String) : [],
    totalChanges: typeof r['totalChanges'] === 'number' ? r['totalChanges'] : all.length,
    truncated: r['truncated'] === true,
    changes: all.slice(offset, offset + limit),
    offset,
    limit,
  };
}

export function formatInspectionMarkdown(
  before: WorkbookInspection,
  after: WorkbookInspection,
  applied: AppliedEdit[],
): string {
  const lines: string[] = [];
  lines.push("## Workbook inspection");
  lines.push("");
  lines.push(`Sheets (${after.sheets.length}): ${after.sheets.join(", ") || "(none)"}`);
  const delta = after.formulaCount - before.formulaCount;
  lines.push(
    `Formulas: ${before.formulaCount} -> ${after.formulaCount}` +
      (delta === 0 ? "" : ` (${delta > 0 ? "+" : ""}${delta})`),
  );
  const added = newErrorCells(before, after);
  const resolved = before.cachedErrorCells.filter((c) => !after.cachedErrorCells.includes(c));
  lines.push(`Cached errors before: ${before.cachedErrorCells.length}`);
  lines.push(`Cached errors after: ${after.cachedErrorCells.length}`);
  lines.push(`New errors: ${added.length === 0 ? "none" : added.join(", ")}`);
  lines.push(`Resolved errors: ${resolved.length === 0 ? "none" : resolved.join(", ")}`);
  lines.push("");
  lines.push(`Applied edits (${applied.length}):`);
  if (applied.length === 0) {
    lines.push("- (none)");
  } else {
    for (const e of applied) {
      const next = e.formula !== undefined ? e.formula : JSON.stringify(e.value ?? null);
      const was =
        e.priorFormula !== null ? ` [was formula ${e.priorFormula}]` : ` [was ${JSON.stringify(e.priorValue)}]`;
      lines.push(`- ${e.sheet}!${e.cell}: ${was} -> ${next}`);
    }
  }
  return lines.join("\n");
}
