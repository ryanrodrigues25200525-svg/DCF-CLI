import { spawnSync } from 'node:child_process';
import { access, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { HistoricalData } from '@/core/types';
import { BackendApiClient } from '@/api/backend-client';
import { parseDcfExportPayload, parseModelEligibility } from '@/api/contracts';
import { LocalBackendProcess } from '@/infrastructure/local-backend-process';
import { buildBaseAssumptions } from '@/services/dcf/assumption-policy';
import { calculateDCF, calculateInitialAssumptions } from '@/services/dcf/engine';
import { detectIndustryTemplate } from '@/core/data/industry-templates';
import {
  mapCanonicalBankFinancialsToHistoricals,
  mapCanonicalFinancialsToHistoricals,
  mapCanonicalInsuranceFinancialsToHistoricals,
  mapCanonicalReitFinancialsToHistoricals,
  mapCanonicalAssetManagerFinancialsToHistoricals,
  mapCanonicalTelecomFinancialsToHistoricals,
  mapCanonicalMortgageReitFinancialsToHistoricals,
  mapNativeProfile,
} from '@/services/integration/sec/native-normalizer';
import { calculateBankValuation } from '@/services/valuation/bank-model';
import type { BankModelAssumptions } from '@/services/valuation/bank-model';
import { buildSourcedInsuranceModelAssumptions } from '@/services/valuation/insurance-assumption-policy';
import { calculateInsuranceValuation } from '@/services/valuation/insurance-model';
import { buildSourcedReitModelAssumptions } from '@/services/valuation/reit-assumption-policy';
import { calculateReitValuation } from '@/services/valuation/reit-model';
import { calculateUtilityValuation } from '@/services/valuation/utility-model';
import { calculateBiotechRnpv } from '@/services/valuation/biotech-rnpv-model';
import type { BiotechRnpvAssumptions } from '@/services/valuation/biotech-rnpv-model';
import { calculateRoutedValuation } from '@/services/valuation/router';
import { buildBankModelExportPayload } from '@/services/exporters/excel/bank-payload';
import { formatValuationJobSuccess, runValuationJob } from '@/application/run-valuation-job';
import { findSoffice } from '@/workbook/xlsx';

const modelRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = resolve(modelRoot, '..');
const launcherPath = resolve(projectRoot, 'bin/dcfbuild.mjs');
const pythonPath = process.platform === 'win32'
  ? resolve(projectRoot, 'backend/.venv/Scripts/python.exe')
  : resolve(projectRoot, 'backend/.venv/bin/python');
const detectedSoffice = findSoffice();
const liveUnavailableReason = !detectedSoffice
  ? 'Live model tests require LibreOffice. Install it or set SOFFICE_PATH to the soffice executable.'
  : !process.env.EDGAR_IDENTITY?.trim()
    ? 'Set EDGAR_IDENTITY before running the live DCF checks. Its value is never logged.'
    : null;

if (liveUnavailableReason) {
  console.warn(`Skipping live model tests: ${liveUnavailableReason}`);
}

// Read only by the gated suite below, which never executes when a dependency is
// missing. `test:live` preflights these separately so an intended live run still
// fails loudly instead of silently skipping.
const sofficePath = detectedSoffice!;

interface LiveCompanyCase {
  ticker: string;
  modelSheet: string;
  inputCell: string;
  formulaCells: string[];
  bridgeCells?: string[];
  editableCells?: string[];
  dataFormulaCells?: string[];
  dataEditableCells?: string[];
}

const liveCompanyCases: LiveCompanyCase[] = [
  {
    ticker: 'AAPL',
    modelSheet: 'DCF Model - Base (1)',
    inputCell: 'F14',
    formulaCells: ['C12', 'C13', 'C14', 'M20', 'M21', 'O21', 'Q21', 'M24', 'M27', 'M28', 'M45', 'Q45', 'M51', 'M53', 'Q53', 'M65', 'M77', 'M78', 'M83', 'Q83', 'Q94', 'Q96', 'Q97', 'Q98', 'Q111'],
    bridgeCells: ['D37', 'D38', 'D40', 'D41'],
    editableCells: ['F9', 'F10', 'F11', 'F13', 'F14', 'F15', 'F16', 'F17', 'F19', 'I13', 'I14', 'I15', 'I16', 'I17'],
    dataFormulaCells: ['C53', 'L12'],
    dataEditableCells: ['C50', 'C51', 'C52'],
  },
  {
    ticker: 'CRM',
    modelSheet: 'DCF Model - Base (1)',
    inputCell: 'F14',
    formulaCells: ['C12', 'C13', 'C14', 'M20', 'M21', 'O21', 'Q21', 'M24', 'M27', 'M28', 'M45', 'Q45', 'M51', 'M53', 'Q53', 'M65', 'M77', 'M78', 'M83', 'Q83', 'Q94', 'Q96', 'Q97', 'Q98', 'Q111'],
    bridgeCells: ['D37', 'D38', 'D40', 'D41'],
    editableCells: ['F9', 'F10', 'F11', 'F13', 'F14', 'F15', 'F16', 'F17', 'F19', 'I13', 'I14', 'I15', 'I16', 'I17'],
    dataFormulaCells: ['C53', 'L12'],
    dataEditableCells: ['C50', 'C51', 'C52'],
  },
  {
    ticker: 'WMT',
    modelSheet: 'DCF Model - Base (1)',
    inputCell: 'F14',
    formulaCells: ['C12', 'C13', 'C14', 'M20', 'M21', 'O21', 'Q21', 'M24', 'M27', 'M28', 'M45', 'Q45', 'M51', 'M53', 'Q53', 'M65', 'M77', 'M78', 'M83', 'Q83', 'Q94', 'Q96', 'Q97', 'Q98', 'Q111'],
    bridgeCells: ['D37', 'D38', 'D40', 'D41'],
    editableCells: ['F9', 'F10', 'F11', 'F13', 'F14', 'F15', 'F16', 'F17', 'F19', 'I13', 'I14', 'I15', 'I16', 'I17'],
    dataFormulaCells: ['C53', 'L12'],
    dataEditableCells: ['C50', 'C51', 'C52'],
  },
  {
    ticker: 'T',
    modelSheet: 'Telecom Model',
    inputCell: 'L5',
    formulaCells: ['F10', 'F21', 'F22', 'F32', 'F35', 'F41', 'F55', 'F65', 'F67', 'B77', 'B83', 'B85', 'L40'],
  },
  {
    ticker: 'AGNC',
    modelSheet: 'Mortgage REIT Model',
    inputCell: 'N6',
    formulaCells: ['F43', 'F44', 'F45', 'F46', 'F47', 'F48', 'F49', 'F50', 'F54', 'F56', 'F57', 'F59', 'F61', 'F62', 'F64', 'B71', 'B72', 'B74', 'N19', 'N34', 'E81'],
  },
  {
    ticker: 'XOM',
    modelSheet: 'Integrated Energy Model',
    inputCell: 'L6',
    formulaCells: ['E56', 'E58', 'E66', 'E68', 'E69', 'E74', 'E79', 'E80', 'E81', 'E85', 'E87', 'E88', 'E89', 'B91', 'B92', 'B94', 'B95', 'B97', 'C105'],
  },
  {
    ticker: 'PFE',
    modelSheet: 'Mature Pharma Model',
    inputCell: 'B23',
    formulaCells: ['B18', 'B19', 'B20', 'B21'],
  },
  {
    ticker: 'AIG',
    modelSheet: 'Insurance Model',
    inputCell: 'B41',
    formulaCells: ['B57', 'C65', 'C68', 'C73', 'C86', 'C89', 'C95', 'C101', 'B108', 'B109', 'C118', 'E118', 'G118'],
    editableCells: ['B41', 'B42', 'B43', 'B44', 'B45', 'B46', 'B47', 'B48', 'B49', 'B50', 'B51', 'B52', 'B53', 'B54', 'B55', 'B56', 'B58', 'B59', 'B60'],
  },
  {
    ticker: 'PLD',
    modelSheet: 'REIT Model',
    inputCell: 'B51',
    formulaCells: ['D10', 'D18', 'D26', 'D32', 'B60', 'B64', 'C69', 'C71', 'C73', 'B84', 'B85', 'B87', 'C107', 'E107', 'G107'],
    editableCells: ['B51', 'B52', 'B53', 'B54', 'B55', 'B56', 'B57', 'B58', 'B59', 'B61', 'B62', 'B63'],
  },
  {
    ticker: 'CAT',
    modelSheet: 'Comparable Valuation',
    inputCell: 'B6',
    formulaCells: ['B5', 'B7', 'B8', 'B15', 'B17', 'B19', 'F24', 'G24', 'J6', 'K6', 'L6', 'M6'],
    editableCells: ['B6', 'I6', 'I7', 'I8'],
  },
  {
    ticker: 'SNOW',
    modelSheet: 'Comparable Valuation',
    inputCell: 'B6',
    formulaCells: ['B5', 'B7', 'B8', 'B15', 'B17', 'B19', 'F24', 'G24', 'J6', 'K6', 'L6', 'M6'],
    editableCells: ['B6', 'I6', 'I7', 'I8'],
  },
];

const draftSectorCases = [
  {ticker: 'STWD', blockReason: 'INCOMPLETE — no valuation was calculated.', writesWorkbook: true},
  {ticker: 'NEE', blockReason: 'INCOMPLETE — no valuation was calculated.', writesWorkbook: true},
];

const inspectWorkbookPython = String.raw`
import json
import sys
from openpyxl import load_workbook

path = sys.argv[1]
spec = json.loads(sys.argv[2])
workbook = load_workbook(path, data_only=False, read_only=False)
model = workbook[spec['modelSheet']]
formulas = {
    cell: model[cell].value
    for cell in spec['formulaCells']
}
formula_count = sum(
    1
    for sheet in workbook.worksheets
    for row in sheet.iter_rows()
    for cell in row
    if isinstance(cell.value, str) and cell.value.startswith('=')
)
review = workbook['Data Review']
review_statuses = [
    review.cell(row, 1).value
    for row in range(6, review.max_row + 1)
    if review.cell(row, 1).value
]
review_notes = [
    review.cell(row, 3).value
    for row in range(6, review.max_row + 1)
    if review.cell(row, 3).value
]
model_timeline_headers = [model[f'{column}18'].value for column in 'HIJKLMNOPQ']
outputs_sheet = workbook['Outputs - Base'] if 'Outputs - Base' in workbook.sheetnames else None
summary_formula_cells = {} if outputs_sheet is None else {
    cell: outputs_sheet[cell].value
    for cell in ('D43', 'H43')
}
input_cell = model[spec['inputCell']]
editable_cells = {}
for cell_ref in spec.get('editableCells', []):
    cell = model[cell_ref]
    editable_cells[cell_ref] = {
        'value': cell.value,
        'is_formula': isinstance(cell.value, str) and cell.value.startswith('='),
        'font_rgb': cell.font.color.rgb if cell.font.color and cell.font.color.type == 'rgb' else None,
    }
preferred_equity_cell = model['F21'] if model.title == 'DCF Model - Base (1)' else None
data_sheet = workbook['Data Given (Recalculated)'] if 'Data Given (Recalculated)' in workbook.sheetnames else None
data_formula_cells = {} if data_sheet is None else {
    cell: data_sheet[cell].value
    for cell in spec.get('dataFormulaCells', [])
}
data_editable_cells = {}
for cell_ref in spec.get('dataEditableCells', []) if data_sheet is not None else []:
    cell = data_sheet[cell_ref]
    data_editable_cells[cell_ref] = {
        'value': cell.value,
        'is_formula': isinstance(cell.value, str) and cell.value.startswith('='),
        'font_rgb': cell.font.color.rgb if cell.font.color and cell.font.color.type == 'rgb' else None,
    }
formula_refs = [
    f'{sheet.title}!{cell.coordinate}'
    for sheet in workbook.worksheets
    for row in sheet.iter_rows()
    for cell in row
    if isinstance(cell.value, str) and cell.value.startswith('=') and '#REF!' in cell.value.upper()
]
print(json.dumps({
    'sheets': workbook.sheetnames,
    'model_title': model['A1'].value,
    'model_timeline_headers': model_timeline_headers,
    'formula_count': formula_count,
    'formula_cells': formulas,
    'summary_formula_cells': summary_formula_cells,
    'bridge_formulas': {
        cell: workbook['Outputs - Base'][cell].value
        for cell in spec.get('bridgeCells', [])
    },
    'formula_refs': formula_refs,
    'input_value': input_cell.value,
    'input_is_formula': isinstance(input_cell.value, str) and input_cell.value.startswith('='),
    'input_font_rgb': input_cell.font.color.rgb if input_cell.font.color and input_cell.font.color.type == 'rgb' else None,
    'editable_cells': editable_cells,
    'data_formula_cells': data_formula_cells,
    'data_editable_cells': data_editable_cells,
    'latest_actual_nwc_value': data_sheet['K40'].value if data_sheet is not None else None,
    'first_forecast_nwc_formula': data_sheet['L40'].value if data_sheet is not None else None,
    'first_forecast_nwc_change_formula': data_sheet['L41'].value if data_sheet is not None else None,
    'preferred_equity_value': preferred_equity_cell.value if preferred_equity_cell else None,
    'preferred_equity_is_formula': isinstance(preferred_equity_cell.value, str) and preferred_equity_cell.value.startswith('=') if preferred_equity_cell else False,
    'preferred_equity_font_rgb': preferred_equity_cell.font.color.rgb if preferred_equity_cell and preferred_equity_cell.font.color and preferred_equity_cell.font.color.type == 'rgb' else None,
    'preferred_equity_label': model['E21'].value if preferred_equity_cell else None,
    'nwc_driver_label': model['E10'].value,
    'nwc_driver_comment': model['F10'].comment.text if model['F10'].comment else None,
    'review_statuses': review_statuses,
    'review_notes': review_notes,
}))
`;

const inspectIncompleteWorkbookPython = String.raw`
import json
import subprocess
import sys
from pathlib import Path
from openpyxl import load_workbook

source_path = Path(sys.argv[1])
filled_value = sys.argv[3] if len(sys.argv) > 3 else ''
source_reference = sys.argv[4] if len(sys.argv) > 4 else ''
complete_path = Path(sys.argv[5]) if len(sys.argv) > 5 and sys.argv[5] else None
if filled_value:
    editable = load_workbook(source_path, data_only=False, read_only=False)
    if 'Input Required' not in editable.sheetnames:
        raise RuntimeError('Input Required sheet is missing from the incomplete workbook.')
    editable_sheet = editable['Input Required']
    input_row = next((row for row in range(1, editable_sheet.max_row + 1) if editable_sheet.cell(row, 1).value == 'capex'), None)
    if input_row is None:
        raise RuntimeError('CapEx input cell is missing from the incomplete workbook.')
    editable_sheet.cell(input_row, 6).value = float(filled_value)
    editable_sheet.cell(input_row, 7).value = source_reference
    source_path = source_path.with_name('filled_capex.xlsx')
    editable.save(source_path)
recalc_dir = source_path.parent / 'recalculated_incomplete'
recalc_dir.mkdir(parents=True, exist_ok=True)
source_paths = [source_path, *([complete_path] if complete_path is not None else [])]
process = subprocess.run([
    sys.argv[2], '--headless', '--convert-to', 'xlsx', '--outdir', str(recalc_dir), *[str(path) for path in source_paths],
], capture_output=True, text=True, timeout=120)
if process.returncode != 0:
    raise RuntimeError(process.stderr or process.stdout or 'LibreOffice failed to recalculate the incomplete workbook.')
recalculated_path = recalc_dir / source_path.name
workbook = load_workbook(recalculated_path, data_only=False, read_only=False)
cached = load_workbook(recalculated_path, data_only=True, read_only=False)
result = {'sheets': workbook.sheetnames}
input_sheet = workbook['Input Required'] if 'Input Required' in workbook.sheetnames else None
review = workbook['Data Review'] if 'Data Review' in workbook.sheetnames else None
result['status_formula'] = input_sheet['B3'].value if input_sheet is not None else None
result['status_value'] = cached['Input Required']['B3'].value if 'Input Required' in cached.sheetnames else None
result['input_sheet_protected'] = input_sheet.protection.sheet if input_sheet is not None else None
result['review_sheet_protected'] = review.protection.sheet if review is not None else None
result['formula_errors'] = [
    f'{sheet.title}!{cell.coordinate}={cell.value}'
    for sheet in cached.worksheets
    for row in sheet.iter_rows()
    for cell in row
    if isinstance(cell.value, str) and cell.value.startswith('#')
]
if input_sheet is not None:
    input_row = next((row for row in range(1, input_sheet.max_row + 1) if input_sheet.cell(row, 1).value == 'capex'), None)
    if input_row is not None:
        value_cell = input_sheet.cell(input_row, 6)
        result['input_value'] = value_cell.value
        result['input_coordinate'] = value_cell.coordinate
        result['input_font_rgb'] = value_cell.font.color.rgb if value_cell.font.color and value_cell.font.color.type == 'rgb' else None
        result['input_locked'] = value_cell.protection.locked
model_name = 'DCF Model - Base (1)'
if model_name in workbook.sheetnames:
    model = workbook[model_name]
    cached_model = cached[model_name]
    result['dcf_sheet_protected'] = model.protection.sheet
    result['dcf_formula_count'] = sum(
        1 for row in model.iter_rows() for cell in row
        if isinstance(cell.value, str) and cell.value.startswith('=')
    )
    result['forecast_formula'] = model['M78'].value
    result['forecast_value'] = cached_model['M78'].value
    result['valuation_values'] = [
        cached_model['Q94'].value,
        cached_model['Q98'].value,
        cached_model['Q100'].value,
        cached_model['Q111'].value,
        cached['Outputs - Base']['D40'].value if 'Outputs - Base' in cached.sheetnames else None,
        cached['Outputs - Base']['D42'].value if 'Outputs - Base' in cached.sheetnames else None,
        cached['Outputs - Base']['D43'].value if 'Outputs - Base' in cached.sheetnames else None,
        cached['Outputs - Base']['H40'].value if 'Outputs - Base' in cached.sheetnames else None,
        cached['Outputs - Base']['H42'].value if 'Outputs - Base' in cached.sheetnames else None,
        cached['Outputs - Base']['H43'].value if 'Outputs - Base' in cached.sheetnames else None,
    ]
if complete_path is not None:
    complete_cached = load_workbook(recalc_dir / complete_path.name, data_only=True, read_only=False)
    complete_outputs = complete_cached['Outputs - Base']
    result['complete_values'] = [
        complete_outputs['D40'].value,
        complete_outputs['D43'].value,
        complete_outputs['H40'].value,
        complete_outputs['H43'].value,
    ]
if review is not None:
    review_row = next((row for row in range(1, review.max_row + 1) if review.cell(row, 1).value == 'capex'), None)
    if review_row is not None:
        result['review_row'] = [review.cell(review_row, column).value for column in range(1, review.max_column + 1)]
print(json.dumps(result))
`;

const inspectIncompleteBankWorkbookPython = String.raw`
import json
import subprocess
import sys
from pathlib import Path
from openpyxl import load_workbook

source_path = Path(sys.argv[1])
soffice_path = sys.argv[2]
restore_value = sys.argv[3] if len(sys.argv) > 3 else ''
source_reference = sys.argv[4] if len(sys.argv) > 4 else ''
complete_path = Path(sys.argv[5]) if len(sys.argv) > 5 and sys.argv[5] else None
recalc_dir = source_path.parent / 'recalculated_incomplete_bank'
recalc_dir.mkdir(parents=True, exist_ok=True)
restore_path = None
source_paths = [source_path]
if restore_value:
    restored = load_workbook(source_path, data_only=False)
    inputs = restored['Input Required']
    row = next((row for row in range(1, inputs.max_row + 1) if inputs.cell(row, 1).value == 'minimum_cet1_ratio'), None)
    if row is None:
        raise RuntimeError('The bank workbook has no minimum_cet1_ratio input row.')
    inputs.cell(row, 6, float(restore_value))
    inputs.cell(row, 7, source_reference)
    restore_path = source_path.with_name('restored-' + source_path.name)
    restored.save(restore_path)
    source_paths.append(restore_path)
if complete_path is not None:
    source_paths.append(complete_path)
profile_dir = source_path.parent / 'libreoffice-profile-incomplete-bank'
profile_dir.mkdir(parents=True, exist_ok=True)
process = subprocess.run([
    soffice_path, '--headless', f'-env:UserInstallation={profile_dir.as_uri()}',
    '--convert-to', 'xlsx', '--outdir', str(recalc_dir), *[str(path) for path in source_paths],
], capture_output=True, text=True, timeout=90)
if process.returncode != 0:
    raise RuntimeError(process.stderr or process.stdout or 'LibreOffice failed to recalculate the incomplete bank workbook.')
recalculated_path = recalc_dir / source_path.name
formulas = load_workbook(recalculated_path, data_only=False, read_only=False)
cached = load_workbook(recalculated_path, data_only=True, read_only=False)
result = {'sheets': formulas.sheetnames, 'formula_errors': [], 'status_value': cached['Input Required']['B3'].value}
if 'Input Required' in formulas.sheetnames:
    inputs = formulas['Input Required']
    row = next((row for row in range(1, inputs.max_row + 1) if inputs.cell(row, 1).value == 'minimum_cet1_ratio'), None)
    result['required_input_row'] = row
    if row is not None:
        result['input_value'] = inputs.cell(row, 6).value
        result['input_font_rgb'] = inputs.cell(row, 6).font.color.rgb if inputs.cell(row, 6).font.color and inputs.cell(row, 6).font.color.type == 'rgb' else None
        result['input_locked'] = inputs.cell(row, 6).protection.locked
        result['source_required'] = inputs.cell(row, 8).value
if 'Bank Model' in formulas.sheetnames:
    model = formulas['Bank Model']
    cached_model = cached['Bank Model']
    result['minimum_cet1_input'] = cached_model['B33'].value
    result['minimum_cet1_formula'] = model['B33'].value
    result['equity_value'] = cached_model['B77'].value
    result['per_share'] = cached_model['B78'].value
    result['guarded_formulas'] = {cell: model[cell].value for cell in ('B33', 'C44', 'C63', 'C67', 'C71', 'C72', 'B74', 'B77', 'B78', 'B80', 'H89', 'E89')}
    result['guarded_values'] = {cell: cached_model[cell].value for cell in ('C44', 'C63', 'C67', 'C71', 'C72', 'B74', 'B75', 'B76', 'B77', 'B78', 'B80', 'H89', 'E89')}
if 'Data Review' in formulas.sheetnames:
    review = formulas['Data Review']
    cached_review = cached['Data Review']
    review_row = next((row for row in range(1, review.max_row + 1) if review.cell(row, 1).value == 'minimum_cet1_ratio'), None)
    result['data_review_row'] = review_row
    if review_row is not None:
        result['data_review_values'] = [review.cell(review_row, column).value for column in range(1, 10)]
        result['data_review_status'] = cached_review.cell(review_row, 3).value
result['formula_errors'] = [
    f'{sheet.title}!{cell.coordinate}={cell.value}'
    for sheet in cached.worksheets
    for row in sheet.iter_rows()
    for cell in row
    if isinstance(cell.value, str) and cell.value.startswith('#')
]
if restore_path is not None:
    restored_cached = load_workbook(recalc_dir / restore_path.name, data_only=True, read_only=False)
    result['restored_status'] = restored_cached['Input Required']['B3'].value
    result['restored_equity_value'] = restored_cached['Bank Model']['B77'].value
    result['restored_per_share'] = restored_cached['Bank Model']['B78'].value
    restored_review = restored_cached['Data Review']
    restored_review_row = next((row for row in range(1, restored_review.max_row + 1) if restored_review.cell(row, 1).value == 'minimum_cet1_ratio'), None)
    if restored_review_row is not None:
        result['restored_source_reference'] = restored_review.cell(restored_review_row, 9).value
if complete_path is not None:
    complete_cached = load_workbook(recalc_dir / complete_path.name, data_only=True, read_only=False)
    result['complete_equity_value'] = complete_cached['Bank Model']['B77'].value
    result['complete_per_share'] = complete_cached['Bank Model']['B78'].value
print(json.dumps(result))
`;

const inspectIncompleteInsuranceWorkbookPython = String.raw`
import json
import subprocess
import sys
from pathlib import Path
from openpyxl import load_workbook

source_path = Path(sys.argv[1])
soffice_path = sys.argv[2]
restore_value = sys.argv[3] if len(sys.argv) > 3 else ''
source_reference = sys.argv[4] if len(sys.argv) > 4 else ''
complete_path = Path(sys.argv[5]) if len(sys.argv) > 5 and sys.argv[5] else None
recalc_dir = source_path.parent / 'recalculated_incomplete_insurance'
recalc_dir.mkdir(parents=True, exist_ok=True)
restore_path = None
source_paths = [source_path]
if restore_value:
    restored = load_workbook(source_path, data_only=False)
    inputs = restored['Input Required']
    row = next((row for row in range(1, inputs.max_row + 1) if inputs.cell(row, 1).value == 'unpaid_loss_reserves'), None)
    if row is None:
        raise RuntimeError('The P&C workbook has no unpaid_loss_reserves input row.')
    inputs.cell(row, 6, float(restore_value))
    inputs.cell(row, 7, source_reference)
    restore_path = source_path.with_name('restored-' + source_path.name)
    restored.save(restore_path)
    source_paths.append(restore_path)
if complete_path is not None:
    source_paths.append(complete_path)
profile_dir = source_path.parent / 'libreoffice-profile-incomplete-insurance'
profile_dir.mkdir(parents=True, exist_ok=True)
process = subprocess.run([
    soffice_path, '--headless', f'-env:UserInstallation={profile_dir.as_uri()}',
    '--convert-to', 'xlsx', '--outdir', str(recalc_dir), *[str(path) for path in source_paths],
], capture_output=True, text=True, timeout=90)
if process.returncode != 0:
    raise RuntimeError(process.stderr or process.stdout or 'LibreOffice failed to recalculate the incomplete P&C workbook.')
recalculated_path = recalc_dir / source_path.name
formulas = load_workbook(recalculated_path, data_only=False, read_only=False)
cached = load_workbook(recalculated_path, data_only=True, read_only=False)
result = {'sheets': formulas.sheetnames, 'formula_errors': [], 'status_value': cached['Input Required']['B3'].value}
inputs = formulas['Input Required']
input_row = next((row for row in range(1, inputs.max_row + 1) if inputs.cell(row, 1).value == 'unpaid_loss_reserves'), None)
result['required_input_row'] = input_row
if input_row is not None:
    result['input_value'] = inputs.cell(input_row, 6).value
    result['input_font_rgb'] = inputs.cell(input_row, 6).font.color.rgb if inputs.cell(input_row, 6).font.color and inputs.cell(input_row, 6).font.color.type == 'rgb' else None
    result['input_locked'] = inputs.cell(input_row, 6).protection.locked
    result['source_required'] = inputs.cell(input_row, 8).value
model = formulas['Insurance Model']
cached_model = cached['Insurance Model']
result['reserve_value'] = cached_model['B22'].value
result['reserve_formula'] = model['B22'].value
result['reserve_check'] = cached_model['B25'].value
result['enterprise_value_note'] = model['B112'].value
result['guarded_formulas'] = {cell: model[cell].value for cell in ('B22', 'B25', 'C65', 'C82', 'C86', 'C89', 'C101', 'C102', 'B105', 'B108', 'B109', 'B111', 'H118', 'E118')}
result['guarded_values'] = {cell: cached_model[cell].value for cell in ('C65', 'C82', 'C86', 'C89', 'C101', 'C102', 'B105', 'B106', 'B107', 'B108', 'B109', 'B111', 'H118', 'E118')}
review = formulas['Data Review']
cached_review = cached['Data Review']
review_row = next((row for row in range(1, review.max_row + 1) if review.cell(row, 1).value == 'unpaid_loss_reserves'), None)
result['data_review_row'] = review_row
if review_row is not None:
    result['data_review_values'] = [review.cell(review_row, column).value for column in range(1, 10)]
    result['data_review_status'] = cached_review.cell(review_row, 3).value
result['formula_errors'] = [
    f'{sheet.title}!{cell.coordinate}={cell.value}'
    for sheet in cached.worksheets for row in sheet.iter_rows() for cell in row
    if isinstance(cell.value, str) and cell.value.startswith('#')
]
if restore_path is not None:
    restored_cached = load_workbook(recalc_dir / restore_path.name, data_only=True, read_only=False)
    result['restored_status'] = restored_cached['Input Required']['B3'].value
    result['restored_equity_value'] = restored_cached['Insurance Model']['B108'].value
    result['restored_per_share'] = restored_cached['Insurance Model']['B109'].value
    restored_review = restored_cached['Data Review']
    restored_review_row = next((row for row in range(1, restored_review.max_row + 1) if restored_review.cell(row, 1).value == 'unpaid_loss_reserves'), None)
    if restored_review_row is not None:
        result['restored_source_reference'] = restored_review.cell(restored_review_row, 9).value
if complete_path is not None:
    complete_cached = load_workbook(recalc_dir / complete_path.name, data_only=True, read_only=False)
    result['complete_equity_value'] = complete_cached['Insurance Model']['B108'].value
    result['complete_per_share'] = complete_cached['Insurance Model']['B109'].value
print(json.dumps(result))
`;

const inspectIncompleteReitWorkbookPython = String.raw`
import json
import subprocess
import sys
from pathlib import Path
from openpyxl import load_workbook

source_path = Path(sys.argv[1])
soffice_path = sys.argv[2]
restore_value = sys.argv[3] if len(sys.argv) > 3 else ''
source_reference = sys.argv[4] if len(sys.argv) > 4 else ''
complete_path = Path(sys.argv[5]) if len(sys.argv) > 5 and sys.argv[5] else None
recalc_dir = source_path.parent / 'recalculated_incomplete_reit'
recalc_dir.mkdir(parents=True, exist_ok=True)
restore_path = None
source_paths = [source_path]
if restore_value:
    restored = load_workbook(source_path, data_only=False)
    inputs = restored['Input Required']
    row = next((row for row in range(1, inputs.max_row + 1) if inputs.cell(row, 1).value == 'same_store_noi_growth'), None)
    if row is None:
        raise RuntimeError('The REIT workbook has no same_store_noi_growth input row.')
    inputs.cell(row, 6, float(restore_value))
    inputs.cell(row, 7, source_reference)
    restore_path = source_path.with_name('restored-' + source_path.name)
    restored.save(restore_path)
    source_paths.append(restore_path)
if complete_path is not None:
    source_paths.append(complete_path)
profile_dir = source_path.parent / 'libreoffice-profile-incomplete-reit'
profile_dir.mkdir(parents=True, exist_ok=True)
process = subprocess.run([
    soffice_path, '--headless', f'-env:UserInstallation={profile_dir.as_uri()}',
    '--convert-to', 'xlsx', '--outdir', str(recalc_dir), *[str(path) for path in source_paths],
], capture_output=True, text=True, timeout=90)
if process.returncode != 0:
    raise RuntimeError(process.stderr or process.stdout or 'LibreOffice failed to recalculate the incomplete REIT workbook.')
recalculated_path = recalc_dir / source_path.name
formulas = load_workbook(recalculated_path, data_only=False, read_only=False)
cached = load_workbook(recalculated_path, data_only=True, read_only=False)
result = {'sheets': formulas.sheetnames, 'formula_errors': [], 'status_value': cached['Input Required']['B3'].value}
inputs = formulas['Input Required']
input_row = next((row for row in range(1, inputs.max_row + 1) if inputs.cell(row, 1).value == 'same_store_noi_growth'), None)
result['required_input_row'] = input_row
if input_row is not None:
    result['input_value'] = inputs.cell(input_row, 6).value
    result['input_font_rgb'] = inputs.cell(input_row, 6).font.color.rgb if inputs.cell(input_row, 6).font.color and inputs.cell(input_row, 6).font.color.type == 'rgb' else None
    result['input_locked'] = inputs.cell(input_row, 6).protection.locked
    result['source_required'] = inputs.cell(input_row, 8).value
model = formulas['REIT Model']
cached_model = cached['REIT Model']
result['growth_value'] = cached_model['B51'].value
result['growth_formula'] = model['B51'].value
result['enterprise_value_note'] = model['B88'].value
result['guarded_formulas'] = {cell: model[cell].value for cell in ('B51', 'C69', 'C71', 'C73', 'B81', 'B84', 'B85', 'B87', 'B93', 'B98', 'B99', 'B101', 'H107', 'E107', 'E116')}
result['guarded_values'] = {cell: cached_model[cell].value for cell in ('C69', 'C71', 'C73', 'C76', 'B81', 'B82', 'B83', 'B84', 'B85', 'B87', 'B93', 'B98', 'B99', 'B101', 'H107', 'E107', 'E116')}
review = formulas['Data Review']
cached_review = cached['Data Review']
review_row = next((row for row in range(1, review.max_row + 1) if review.cell(row, 1).value == 'same_store_noi_growth'), None)
result['data_review_row'] = review_row
if review_row is not None:
    result['data_review_values'] = [review.cell(review_row, column).value for column in range(1, 10)]
    result['data_review_status'] = cached_review.cell(review_row, 3).value
result['formula_errors'] = [
    f'{sheet.title}!{cell.coordinate}={cell.value}'
    for sheet in cached.worksheets for row in sheet.iter_rows() for cell in row
    if isinstance(cell.value, str) and cell.value.startswith('#')
]
if restore_path is not None:
    restored_cached = load_workbook(recalc_dir / restore_path.name, data_only=True, read_only=False)
    result['restored_status'] = restored_cached['Input Required']['B3'].value
    result['restored_equity_value'] = restored_cached['REIT Model']['B84'].value
    result['restored_per_share'] = restored_cached['REIT Model']['B85'].value
    result['restored_nav_value'] = restored_cached['REIT Model']['B98'].value
    result['restored_nav_per_share'] = restored_cached['REIT Model']['B99'].value
    restored_review = restored_cached['Data Review']
    restored_review_row = next((row for row in range(1, restored_review.max_row + 1) if restored_review.cell(row, 1).value == 'same_store_noi_growth'), None)
    if restored_review_row is not None:
        result['restored_source_reference'] = restored_review.cell(restored_review_row, 9).value
if complete_path is not None:
    complete_cached = load_workbook(recalc_dir / complete_path.name, data_only=True, read_only=False)
    result['complete_equity_value'] = complete_cached['REIT Model']['B84'].value
    result['complete_per_share'] = complete_cached['REIT Model']['B85'].value
print(json.dumps(result))
`;

const inspectIncompleteMortgageReitWorkbookPython = String.raw`
import json
import subprocess
import sys
from pathlib import Path
from openpyxl import load_workbook

source_path = Path(sys.argv[1])
soffice_path = sys.argv[2]
restore_value = sys.argv[3] if len(sys.argv) > 3 else ''
source_reference = sys.argv[4] if len(sys.argv) > 4 else ''
complete_path = Path(sys.argv[5]) if len(sys.argv) > 5 and sys.argv[5] else None
recalc_dir = source_path.parent / 'recalculated_incomplete_mortgage_reit'
recalc_dir.mkdir(parents=True, exist_ok=True)
restore_path = None
source_paths = [source_path]
if restore_value:
    restored = load_workbook(source_path, data_only=False)
    inputs = restored['Input Required']
    row = next((row for row in range(1, inputs.max_row + 1) if inputs.cell(row, 1).value == 'average_repo_borrowings'), None)
    if row is None:
        raise RuntimeError('The mortgage REIT workbook has no average_repo_borrowings input row.')
    inputs.cell(row, 6, float(restore_value))
    inputs.cell(row, 7, source_reference)
    restore_path = source_path.with_name('restored-' + source_path.name)
    restored.save(restore_path)
    source_paths.append(restore_path)
if complete_path is not None:
    source_paths.append(complete_path)
profile_dir = source_path.parent / 'libreoffice-profile-incomplete-mortgage-reit'
profile_dir.mkdir(parents=True, exist_ok=True)
process = subprocess.run([
    soffice_path, '--headless', f'-env:UserInstallation={profile_dir.as_uri()}',
    '--convert-to', 'xlsx', '--outdir', str(recalc_dir), *[str(path) for path in source_paths],
], capture_output=True, text=True, timeout=90)
if process.returncode != 0:
    raise RuntimeError(process.stderr or process.stdout or 'LibreOffice failed to recalculate the incomplete mortgage REIT workbook.')
recalculated_path = recalc_dir / source_path.name
formulas = load_workbook(recalculated_path, data_only=False, read_only=False)
cached = load_workbook(recalculated_path, data_only=True, read_only=False)
result = {'sheets': formulas.sheetnames, 'formula_errors': [], 'status_value': cached['Input Required']['B3'].value}
inputs = formulas['Input Required']
input_row = next((row for row in range(1, inputs.max_row + 1) if inputs.cell(row, 1).value == 'average_repo_borrowings'), None)
result['required_input_row'] = input_row
if input_row is not None:
    result['input_value'] = inputs.cell(input_row, 6).value
    result['input_font_rgb'] = inputs.cell(input_row, 6).font.color.rgb if inputs.cell(input_row, 6).font.color and inputs.cell(input_row, 6).font.color.type == 'rgb' else None
    result['input_locked'] = inputs.cell(input_row, 6).protection.locked
    result['source_required'] = inputs.cell(input_row, 8).value
model = formulas['Mortgage REIT Model']
cached_model = cached['Mortgage REIT Model']
result['repo_value'] = cached_model['N35'].value
result['repo_formula'] = model['N35'].value
result['spread_check'] = cached_model['E14'].value
result['enterprise_value_note'] = model['E70'].value
result['guarded_formulas'] = {cell: model[cell].value for cell in ('N35', 'E14', 'F48', 'F50', 'F61', 'F62', 'F64', 'B69', 'B71', 'B72', 'B74', 'C79')}
result['guarded_values'] = {cell: cached_model[cell].value for cell in ('F48', 'F50', 'F61', 'F62', 'F64', 'B69', 'B70', 'B71', 'B72', 'B74', 'C79', 'E81')}
review = formulas['Data Review']
cached_review = cached['Data Review']
review_row = next((row for row in range(1, review.max_row + 1) if review.cell(row, 1).value == 'average_repo_borrowings'), None)
result['data_review_row'] = review_row
if review_row is not None:
    result['data_review_values'] = [review.cell(review_row, column).value for column in range(1, 10)]
    result['data_review_status'] = cached_review.cell(review_row, 3).value
result['formula_errors'] = [
    f'{sheet.title}!{cell.coordinate}={cell.value}'
    for sheet in cached.worksheets for row in sheet.iter_rows() for cell in row
    if isinstance(cell.value, str) and cell.value.startswith('#')
]
if restore_path is not None:
    restored_cached = load_workbook(recalc_dir / restore_path.name, data_only=True, read_only=False)
    result['restored_status'] = restored_cached['Input Required']['B3'].value
    result['restored_equity_value'] = restored_cached['Mortgage REIT Model']['B72'].value
    result['restored_per_share'] = restored_cached['Mortgage REIT Model']['B71'].value
    restored_review = restored_cached['Data Review']
    restored_review_row = next((row for row in range(1, restored_review.max_row + 1) if restored_review.cell(row, 1).value == 'average_repo_borrowings'), None)
    if restored_review_row is not None:
        result['restored_source_reference'] = restored_review.cell(restored_review_row, 9).value
if complete_path is not None:
    complete_cached = load_workbook(recalc_dir / complete_path.name, data_only=True, read_only=False)
    result['complete_equity_value'] = complete_cached['Mortgage REIT Model']['B72'].value
    result['complete_per_share'] = complete_cached['Mortgage REIT Model']['B71'].value
print(json.dumps(result))
`;

const inspectIncompleteAssetManagerWorkbookPython = String.raw`
import json
import subprocess
import sys
from pathlib import Path
from openpyxl import load_workbook

source_path = Path(sys.argv[1])
soffice_path = sys.argv[2]
restore_value = sys.argv[3] if len(sys.argv) > 3 else ''
source_reference = sys.argv[4] if len(sys.argv) > 4 else ''
complete_path = Path(sys.argv[5]) if len(sys.argv) > 5 and sys.argv[5] else None
recalc_dir = source_path.parent / 'recalculated_incomplete_asset_manager'
recalc_dir.mkdir(parents=True, exist_ok=True)
restore_path = None
source_paths = [source_path]
if restore_value:
    restored = load_workbook(source_path, data_only=False)
    inputs = restored['Input Required']
    row = next((row for row in range(1, inputs.max_row + 1) if inputs.cell(row, 1).value == 'base_fee_yield'), None)
    if row is None:
        raise RuntimeError('The asset-manager workbook has no base_fee_yield input row.')
    inputs.cell(row, 6, float(restore_value))
    inputs.cell(row, 7, source_reference)
    restore_path = source_path.with_name('restored-' + source_path.name)
    restored.save(restore_path)
    source_paths.append(restore_path)
if complete_path is not None:
    source_paths.append(complete_path)
profile_dir = source_path.parent / 'libreoffice-profile-incomplete-asset-manager'
profile_dir.mkdir(parents=True, exist_ok=True)
process = subprocess.run([
    soffice_path, '--headless', f'-env:UserInstallation={profile_dir.as_uri()}',
    '--convert-to', 'xlsx', '--outdir', str(recalc_dir), *[str(path) for path in source_paths],
], capture_output=True, text=True, timeout=90)
if process.returncode != 0:
    raise RuntimeError(process.stderr or process.stdout or 'LibreOffice failed to recalculate the incomplete asset-manager workbook.')
recalculated_path = recalc_dir / source_path.name
formulas = load_workbook(recalculated_path, data_only=False, read_only=False)
cached = load_workbook(recalculated_path, data_only=True, read_only=False)
result = {'sheets': formulas.sheetnames, 'formula_errors': [], 'status_value': cached['Input Required']['B3'].value}
inputs = formulas['Input Required']
input_row = next((row for row in range(1, inputs.max_row + 1) if inputs.cell(row, 1).value == 'base_fee_yield'), None)
result['required_input_row'] = input_row
if input_row is not None:
    result['input_value'] = inputs.cell(input_row, 6).value
    result['input_font_rgb'] = inputs.cell(input_row, 6).font.color.rgb if inputs.cell(input_row, 6).font.color and inputs.cell(input_row, 6).font.color.type == 'rgb' else None
    result['input_locked'] = inputs.cell(input_row, 6).protection.locked
    result['source_required'] = inputs.cell(input_row, 8).value
model = formulas['Asset Manager Model']
cached_model = cached['Asset Manager Model']
result['schedule_input'] = cached_model['C17'].value
result['schedule_input_formula'] = model['C17'].value
result['base_fee_yield_assumption'] = cached_model['L11'].value
result['base_fee_yield_formula'] = model['L11'].value
result['guarded_formulas'] = {cell: model[cell].value for cell in ('C17', 'L11', 'E12', 'E18', 'E29', 'E44', 'E46', 'B56', 'B62', 'B63', 'B65', 'C73')}
result['guarded_values'] = {cell: cached_model[cell].value for cell in ('E12', 'E18', 'E29', 'E44', 'E46', 'B51', 'B53', 'B54', 'B55', 'B56', 'B62', 'B63', 'B65', 'C73')}
review = formulas['Data Review']
cached_review = cached['Data Review']
review_row = next((row for row in range(1, review.max_row + 1) if review.cell(row, 1).value == 'base_fee_yield'), None)
result['data_review_row'] = review_row
if review_row is not None:
    result['data_review_values'] = [review.cell(review_row, column).value for column in range(1, 10)]
    result['data_review_status'] = cached_review.cell(review_row, 3).value
result['formula_errors'] = [
    f'{sheet.title}!{cell.coordinate}={cell.value}'
    for sheet in cached.worksheets for row in sheet.iter_rows() for cell in row
    if isinstance(cell.value, str) and cell.value.startswith('#')
]
if restore_path is not None:
    restored_cached = load_workbook(recalc_dir / restore_path.name, data_only=True, read_only=False)
    result['restored_status'] = restored_cached['Input Required']['B3'].value
    result['restored_equity_value'] = restored_cached['Asset Manager Model']['B62'].value
    result['restored_per_share'] = restored_cached['Asset Manager Model']['B63'].value
    restored_review = restored_cached['Data Review']
    restored_review_row = next((row for row in range(1, restored_review.max_row + 1) if restored_review.cell(row, 1).value == 'base_fee_yield'), None)
    if restored_review_row is not None:
        result['restored_source_reference'] = restored_review.cell(restored_review_row, 9).value
if complete_path is not None:
    complete_cached = load_workbook(recalc_dir / complete_path.name, data_only=True, read_only=False)
    result['complete_equity_value'] = complete_cached['Asset Manager Model']['B62'].value
    result['complete_per_share'] = complete_cached['Asset Manager Model']['B63'].value
print(json.dumps(result))
`;

const inspectIncompleteTelecomWorkbookPython = String.raw`
import json
import subprocess
import sys
from pathlib import Path
from openpyxl import load_workbook

source_path = Path(sys.argv[1])
soffice_path = sys.argv[2]
restore_value = sys.argv[3] if len(sys.argv) > 3 else ''
source_reference = sys.argv[4] if len(sys.argv) > 4 else ''
complete_path = Path(sys.argv[5]) if len(sys.argv) > 5 and sys.argv[5] else None
recalc_dir = source_path.parent / 'recalculated_incomplete_telecom'
recalc_dir.mkdir(parents=True, exist_ok=True)
restore_path = None
source_paths = [source_path]
if restore_value:
    restored = load_workbook(source_path, data_only=False)
    inputs = restored['Input Required']
    row = next((row for row in range(1, inputs.max_row + 1) if inputs.cell(row, 1).value == 'postpaid_phone_churn'), None)
    if row is None:
        raise RuntimeError('The telecom workbook has no postpaid_phone_churn input row.')
    inputs.cell(row, 6, float(restore_value))
    inputs.cell(row, 7, source_reference)
    restore_path = source_path.with_name('restored-' + source_path.name)
    restored.save(restore_path)
    source_paths.append(restore_path)
if complete_path is not None:
    source_paths.append(complete_path)
profile_dir = source_path.parent / 'libreoffice-profile-incomplete-telecom'
profile_dir.mkdir(parents=True, exist_ok=True)
process = subprocess.run([
    soffice_path, '--headless', f'-env:UserInstallation={profile_dir.as_uri()}',
    '--convert-to', 'xlsx', '--outdir', str(recalc_dir), *[str(path) for path in source_paths],
], capture_output=True, text=True, timeout=90)
if process.returncode != 0:
    raise RuntimeError(process.stderr or process.stdout or 'LibreOffice failed to recalculate the incomplete telecom workbook.')
recalculated_path = recalc_dir / source_path.name
formulas = load_workbook(recalculated_path, data_only=False, read_only=False)
cached = load_workbook(recalculated_path, data_only=True, read_only=False)
result = {'sheets': formulas.sheetnames, 'formula_errors': [], 'status_value': cached['Input Required']['B3'].value}
inputs = formulas['Input Required']
input_row = next((row for row in range(1, inputs.max_row + 1) if inputs.cell(row, 1).value == 'postpaid_phone_churn'), None)
result['required_input_row'] = input_row
if input_row is not None:
    result['input_value'] = inputs.cell(input_row, 6).value
    result['input_font_rgb'] = inputs.cell(input_row, 6).font.color.rgb if inputs.cell(input_row, 6).font.color and inputs.cell(input_row, 6).font.color.type == 'rgb' else None
    result['input_locked'] = inputs.cell(input_row, 6).protection.locked
    result['source_required'] = inputs.cell(input_row, 8).value
model = formulas['Telecom Model']
cached_model = cached['Telecom Model']
result['churn_value'] = cached_model['D7'].value
result['churn_formula'] = model['D7'].value
result['guarded_formulas'] = {cell: model[cell].value for cell in ('D7', 'D6', 'D8', 'L5', 'L6', 'F10', 'F16', 'F22', 'F41', 'F50', 'F55', 'F65', 'F67', 'B77', 'B83', 'B85', 'B87', 'C93')}
result['guarded_values'] = {cell: cached_model[cell].value for cell in ('D6', 'D7', 'D8', 'F10', 'F16', 'F22', 'F41', 'F50', 'F55', 'F65', 'F67', 'B72', 'B74', 'B75', 'B76', 'B77', 'B83', 'B85', 'B87', 'C93')}
result['gross_add_rate'] = cached_model['L5'].value
result['gross_add_rate_formula'] = model['L5'].value
result['churn_assumption'] = cached_model['L6'].value
result['churn_assumption_formula'] = model['L6'].value
review = formulas['Data Review']
cached_review = cached['Data Review']
review_row = next((row for row in range(1, review.max_row + 1) if review.cell(row, 1).value == 'postpaid_phone_churn'), None)
result['data_review_row'] = review_row
if review_row is not None:
    result['data_review_values'] = [review.cell(review_row, column).value for column in range(1, 10)]
    result['data_review_status'] = cached_review.cell(review_row, 3).value
result['formula_errors'] = [
    f'{sheet.title}!{cell.coordinate}={cell.value}'
    for sheet in cached.worksheets for row in sheet.iter_rows() for cell in row
    if isinstance(cell.value, str) and cell.value.startswith('#')
]
if restore_path is not None:
    restored_cached = load_workbook(recalc_dir / restore_path.name, data_only=True, read_only=False)
    result['restored_status'] = restored_cached['Input Required']['B3'].value
    result['restored_equity_value'] = restored_cached['Telecom Model']['B83'].value
    result['restored_per_share'] = restored_cached['Telecom Model']['B85'].value
    restored_review = restored_cached['Data Review']
    restored_review_row = next((row for row in range(1, restored_review.max_row + 1) if restored_review.cell(row, 1).value == 'postpaid_phone_churn'), None)
    if restored_review_row is not None:
        result['restored_source_reference'] = restored_review.cell(restored_review_row, 9).value
if complete_path is not None:
    complete_cached = load_workbook(recalc_dir / complete_path.name, data_only=True, read_only=False)
    result['complete_equity_value'] = complete_cached['Telecom Model']['B83'].value
    result['complete_per_share'] = complete_cached['Telecom Model']['B85'].value
print(json.dumps(result))
`;

const inspectIncompleteIntegratedEnergyWorkbookPython = String.raw`
import json
import subprocess
import sys
from pathlib import Path
from openpyxl import load_workbook

source_path = Path(sys.argv[1])
soffice_path = sys.argv[2]
restore_value = sys.argv[3] if len(sys.argv) > 3 else ''
source_reference = sys.argv[4] if len(sys.argv) > 4 else ''
complete_path = Path(sys.argv[5]) if len(sys.argv) > 5 and sys.argv[5] else None
recalc_dir = source_path.parent / 'recalculated_incomplete_integrated_energy'
recalc_dir.mkdir(parents=True, exist_ok=True)
restore_path = None
source_paths = [source_path]
if restore_value:
    restored = load_workbook(source_path, data_only=False)
    inputs = restored['Input Required']
    row = next((row for row in range(1, inputs.max_row + 1) if inputs.cell(row, 1).value == 'crude_oil_production'), None)
    if row is None:
        raise RuntimeError('The integrated-energy workbook has no crude_oil_production input row.')
    inputs.cell(row, 6, float(restore_value))
    inputs.cell(row, 7, source_reference)
    restore_path = source_path.with_name('restored-' + source_path.name)
    restored.save(restore_path)
    source_paths.append(restore_path)
if complete_path is not None:
    source_paths.append(complete_path)
profile_dir = source_path.parent / 'libreoffice-profile-incomplete-integrated-energy'
profile_dir.mkdir(parents=True, exist_ok=True)
process = subprocess.run([
    soffice_path, '--headless', f'-env:UserInstallation={profile_dir.as_uri()}',
    '--convert-to', 'xlsx', '--outdir', str(recalc_dir), *[str(path) for path in source_paths],
], capture_output=True, text=True, timeout=90)
if process.returncode != 0:
    raise RuntimeError(process.stderr or process.stdout or 'LibreOffice failed to recalculate the incomplete integrated-energy workbook.')
recalculated_path = recalc_dir / source_path.name
formulas = load_workbook(recalculated_path, data_only=False, read_only=False)
cached = load_workbook(recalculated_path, data_only=True, read_only=False)
result = {'sheets': formulas.sheetnames, 'formula_errors': [], 'status_value': cached['Input Required']['B3'].value}
inputs = formulas['Input Required']
input_row = next((row for row in range(1, inputs.max_row + 1) if inputs.cell(row, 1).value == 'crude_oil_production'), None)
result['required_input_row'] = input_row
if input_row is not None:
    result['input_value'] = inputs.cell(input_row, 6).value
    result['input_font_rgb'] = inputs.cell(input_row, 6).font.color.rgb if inputs.cell(input_row, 6).font.color and inputs.cell(input_row, 6).font.color.type == 'rgb' else None
    result['input_locked'] = inputs.cell(input_row, 6).protection.locked
    result['source_required'] = inputs.cell(input_row, 8).value
model = formulas['Integrated Energy Model']
cached_model = cached['Integrated Energy Model']
result['production_value'] = cached_model['D5'].value
result['production_formula'] = model['D5'].value
result['production_revenue'] = cached_model['D22'].value
result['production_margin'] = cached_model['D24'].value
result['conversion_factor'] = cached_model['L23'].value
result['conversion_factor_formula'] = model['L23'].value
result['enterprise_value_note'] = model['A94'].value
result['guarded_formulas'] = {cell: model[cell].value for cell in ('D5', 'D10', 'D22', 'D24', 'L23', 'E66', 'E79', 'B91', 'B94', 'B95', 'B97', 'B98', 'C105')}
result['guarded_values'] = {cell: cached_model[cell].value for cell in ('D10', 'D22', 'D24', 'E51', 'E58', 'E66', 'E79', 'E81', 'B91', 'B92', 'B93', 'B94', 'B95', 'B97', 'B98', 'C105')}
review = formulas['Data Review']
cached_review = cached['Data Review']
review_row = next((row for row in range(1, review.max_row + 1) if review.cell(row, 1).value == 'crude_oil_production'), None)
result['data_review_row'] = review_row
if review_row is not None:
    result['data_review_values'] = [review.cell(review_row, column).value for column in range(1, 10)]
    result['data_review_status'] = cached_review.cell(review_row, 3).value
result['formula_errors'] = [
    f'{sheet.title}!{cell.coordinate}={cell.value}'
    for sheet in cached.worksheets for row in sheet.iter_rows() for cell in row
    if isinstance(cell.value, str) and cell.value.startswith('#')
]
if restore_path is not None:
    restored_cached = load_workbook(recalc_dir / restore_path.name, data_only=True, read_only=False)
    result['restored_status'] = restored_cached['Input Required']['B3'].value
    result['restored_equity_value'] = restored_cached['Integrated Energy Model']['B95'].value
    result['restored_per_share'] = restored_cached['Integrated Energy Model']['B97'].value
    restored_review = restored_cached['Data Review']
    restored_review_row = next((row for row in range(1, restored_review.max_row + 1) if restored_review.cell(row, 1).value == 'crude_oil_production'), None)
    if restored_review_row is not None:
        result['restored_source_reference'] = restored_review.cell(restored_review_row, 9).value
if complete_path is not None:
    complete_cached = load_workbook(recalc_dir / complete_path.name, data_only=True, read_only=False)
    result['complete_equity_value'] = complete_cached['Integrated Energy Model']['B95'].value
    result['complete_per_share'] = complete_cached['Integrated Energy Model']['B97'].value
print(json.dumps(result))
`;

const inspectIncompleteMaturePharmaWorkbookPython = String.raw`
import json
import subprocess
import sys
from pathlib import Path
from openpyxl import load_workbook

source_path = Path(sys.argv[1])
soffice_path = sys.argv[2]
restore_value = sys.argv[3] if len(sys.argv) > 3 else ''
source_reference = sys.argv[4] if len(sys.argv) > 4 else ''
complete_path = Path(sys.argv[5]) if len(sys.argv) > 5 and sys.argv[5] else None
recalc_dir = source_path.parent / 'recalculated_incomplete_mature_pharma'
recalc_dir.mkdir(parents=True, exist_ok=True)
restore_path = None
source_paths = [source_path]
if restore_value:
    restored = load_workbook(source_path, data_only=False)
    inputs = restored['Input Required']
    row = next((row for row in range(1, inputs.max_row + 1) if inputs.cell(row, 1).value == 'product_revenue:eliquis_a'), None)
    if row is None:
        raise RuntimeError('The pharma workbook has no Eliquis product-revenue input row.')
    inputs.cell(row, 6, float(restore_value))
    inputs.cell(row, 7, source_reference)
    restore_path = source_path.with_name('restored-' + source_path.name)
    restored.save(restore_path)
    source_paths.append(restore_path)
if complete_path is not None:
    source_paths.append(complete_path)
profile_dir = source_path.parent / 'libreoffice-profile-incomplete-mature-pharma'
profile_dir.mkdir(parents=True, exist_ok=True)
process = subprocess.run([
    soffice_path, '--headless', f'-env:UserInstallation={profile_dir.as_uri()}',
    '--convert-to', 'xlsx', '--outdir', str(recalc_dir), *[str(path) for path in source_paths],
], capture_output=True, text=True, timeout=120)
if process.returncode != 0:
    raise RuntimeError(process.stderr or process.stdout or 'LibreOffice failed to recalculate the incomplete mature-pharma workbook.')
recalculated_path = recalc_dir / source_path.name
formulas = load_workbook(recalculated_path, data_only=False, read_only=False)
cached = load_workbook(recalculated_path, data_only=True, read_only=False)
result = {'sheets': formulas.sheetnames, 'formula_errors': [], 'status_value': cached['Input Required']['B3'].value}
inputs = formulas['Input Required']
input_row = next((row for row in range(1, inputs.max_row + 1) if inputs.cell(row, 1).value == 'product_revenue:eliquis_a'), None)
result['required_input_row'] = input_row
if input_row is not None:
    result['input_value'] = inputs.cell(input_row, 6).value
    result['input_font_rgb'] = inputs.cell(input_row, 6).font.color.rgb if inputs.cell(input_row, 6).font.color and inputs.cell(input_row, 6).font.color.type == 'rgb' else None
    result['input_locked'] = inputs.cell(input_row, 6).protection.locked
    result['source_required'] = inputs.cell(input_row, 8).value
model = formulas['Mature Pharma Model']
cached_model = cached['Mature Pharma Model']
product_row = next((row for row in range(1, model.max_row + 1) if model.cell(row, 1).value == 'Eliquis (a)'), None)
if product_row is None:
    raise RuntimeError('The mature-pharma product schedule has no Eliquis (a) row.')
result['product_row'] = product_row
result['product_revenue'] = cached_model[f'D{product_row}'].value
result['product_revenue_formula'] = model[f'D{product_row}'].value
result['product_growth'] = cached_model[f'O{product_row}'].value
result['product_growth_formula'] = model[f'O{product_row}'].value
result['patent_years'] = [model[f'{column}{product_row}'].value for column in 'KLMN']
other_row = next((row for row in range(1, model.max_row + 1) if model.cell(row, 1).value == 'Other products / alliance / royalty revenue'), None)
total_row = next((row for row in range(1, model.max_row + 1) if model.cell(row, 1).value == 'Total revenue'), None)
cashflow_start = next((row for row in range(1, model.max_row + 1) if model.cell(row, 1).value == 'EBIT = revenue × editable EBIT margin'), None)
valuation_start = next((row for row in range(1, model.max_row + 1) if model.cell(row, 1).value == 'Enterprise-to-common-equity valuation'), None)
sensitivity_start = next((row for row in range(1, model.max_row + 1) if model.cell(row, 1).value == 'Implied value per share sensitivity — WACC vs. terminal growth'), None)
result['other_row'] = other_row
result['total_row'] = total_row
result['cashflow_start'] = cashflow_start
result['valuation_start'] = valuation_start
result['sensitivity_start'] = sensitivity_start
result['guarded_formulas'] = {
    'D_product': model[f'D{product_row}'].value,
    'O_growth': model[f'O{product_row}'].value,
    'B22': model['B22'].value,
    'F_product': model[f'F{product_row}'].value,
    'F_other': model[f'F{other_row}'].value if other_row else None,
    'F_total': model[f'F{total_row}'].value if total_row else None,
    'F_fcff': model[f'F{cashflow_start+7}'].value if cashflow_start else None,
    'B_enterprise_value': model[f'B{valuation_start+4}'].value if valuation_start else None,
    'B_equity_value': model[f'B{valuation_start+5}'].value if valuation_start else None,
    'B_per_share': model[f'B{valuation_start+7}'].value if valuation_start else None,
    'C_sensitivity': model[f'C{sensitivity_start+2}'].value if sensitivity_start else None,
}
result['guarded_values'] = {
    'D_product': cached_model[f'D{product_row}'].value,
    'O_growth': cached_model[f'O{product_row}'].value,
    'B22': cached_model['B22'].value,
    'F_product': cached_model[f'F{product_row}'].value,
    'F_other': cached_model[f'F{other_row}'].value if other_row else None,
    'F_total': cached_model[f'F{total_row}'].value if total_row else None,
    'F_fcff': cached_model[f'F{cashflow_start+7}'].value if cashflow_start else None,
    'B_equity_value': cached_model[f'B{valuation_start+5}'].value if valuation_start else None,
    'B_per_share': cached_model[f'B{valuation_start+7}'].value if valuation_start else None,
    'C_sensitivity': cached_model[f'C{sensitivity_start+2}'].value if sensitivity_start else None,
}
review = formulas['Data Review']
cached_review = cached['Data Review']
review_row = next((row for row in range(1, review.max_row + 1) if review.cell(row, 1).value == 'product_revenue:eliquis_a'), None)
result['data_review_row'] = review_row
if review_row is not None:
    result['data_review_values'] = [review.cell(review_row, column).value for column in range(1, 10)]
    result['data_review_status'] = cached_review.cell(review_row, 3).value
result['formula_errors'] = [
    f'{sheet.title}!{cell.coordinate}={cell.value}'
    for sheet in cached.worksheets for row in sheet.iter_rows() for cell in row
    if isinstance(cell.value, str) and cell.value.startswith('#')
]
if restore_path is not None:
    restored_cached = load_workbook(recalc_dir / restore_path.name, data_only=True, read_only=False)
    result['restored_status'] = restored_cached['Input Required']['B3'].value
    result['restored_equity_value'] = restored_cached['Mature Pharma Model'][f'B{valuation_start+5}'].value
    result['restored_per_share'] = restored_cached['Mature Pharma Model'][f'B{valuation_start+7}'].value
    restored_review = restored_cached['Data Review']
    restored_review_row = next((row for row in range(1, restored_review.max_row + 1) if restored_review.cell(row, 1).value == 'product_revenue:eliquis_a'), None)
    if restored_review_row is not None:
        result['restored_source_reference'] = restored_review.cell(restored_review_row, 9).value
if complete_path is not None:
    complete_cached = load_workbook(recalc_dir / complete_path.name, data_only=True, read_only=False)
    result['complete_equity_value'] = complete_cached['Mature Pharma Model'][f'B{valuation_start+5}'].value
    result['complete_per_share'] = complete_cached['Mature Pharma Model'][f'B{valuation_start+7}'].value
print(json.dumps(result))
`;

const inspectIncompleteComparableWorkbookPython = String.raw`
import json
import subprocess
import sys
from pathlib import Path
from openpyxl import load_workbook

source_path = Path(sys.argv[1])
soffice_path = sys.argv[2]
metric = sys.argv[3]
peer_ticker = sys.argv[4].upper()
restore_value = float(sys.argv[5])
source_reference = sys.argv[6]
complete_path = Path(sys.argv[7])
denominator_column = 'E' if metric == 'ebitda' else 'D'
multiple_column = 'G' if metric == 'ebitda' else 'F'

edited = load_workbook(complete_path, data_only=False)
edited_model = edited['Comparable Valuation']
if edited_model['B8'].value != '=B4*B7':
    raise RuntimeError('The ready comparable workbook has no expected editable enterprise-value formula.')
edited_model['B8'] = '=B4*B7*1.01'
edited_formula_path = complete_path.with_name('formula-edited-' + complete_path.name)
edited.save(edited_formula_path)

restored = load_workbook(source_path, data_only=False)
inputs = restored['Input Required']
input_row = next((row for row in range(1, inputs.max_row + 1)
                  if inputs.cell(row, 1).value == f'peer_{metric}:{peer_ticker}'), None)
if input_row is None:
    raise RuntimeError('The comparable workbook has no input row for the missing peer denominator.')
inputs.cell(input_row, 6).value = restore_value
inputs.cell(input_row, 7).value = source_reference
restored_path = source_path.with_name('restored-' + source_path.name)
restored.save(restored_path)

invalid = load_workbook(source_path, data_only=False)
invalid_inputs = invalid['Input Required']
invalid_row = next((row for row in range(1, invalid_inputs.max_row + 1)
                    if invalid_inputs.cell(row, 1).value == f'peer_{metric}:{peer_ticker}'), None)
if invalid_row is None:
    raise RuntimeError('The comparable workbook has no input row for invalid-entry inspection.')
invalid_inputs.cell(invalid_row, 6).value = 0
invalid_inputs.cell(invalid_row, 7).value = source_reference
invalid_path = source_path.with_name('invalid-' + source_path.name)
invalid.save(invalid_path)

recalc_dir = source_path.parent / 'recalculated_incomplete_comparable'
recalc_dir.mkdir(parents=True, exist_ok=True)
process = subprocess.run([
    soffice_path, '--headless', '--convert-to', 'xlsx', '--outdir', str(recalc_dir),
    str(source_path), str(restored_path), str(invalid_path), str(complete_path), str(edited_formula_path),
], capture_output=True, text=True, timeout=120)
if process.returncode != 0:
    raise RuntimeError(process.stderr or process.stdout or 'LibreOffice failed to recalculate comparable workbooks.')

def open_pair(path):
    recalculated = recalc_dir / path.name
    return (load_workbook(recalculated, data_only=False, read_only=False),
            load_workbook(recalculated, data_only=True, read_only=False))

formulas, cached = open_pair(source_path)
restored_formulas, restored_cached = open_pair(restored_path)
invalid_formulas, invalid_cached = open_pair(invalid_path)
complete_formulas, complete_cached = open_pair(complete_path)
edited_formulas, edited_cached = open_pair(edited_formula_path)
model = formulas['Comparable Valuation']
cached_model = cached['Comparable Valuation']
restored_model = restored_formulas['Comparable Valuation']
restored_cached_model = restored_cached['Comparable Valuation']
complete_model = complete_cached['Comparable Valuation']
edited_model = edited_cached['Comparable Valuation']
peer_row = next((row for row in range(24, model.max_row + 1)
                 if model.cell(row, 1).value == peer_ticker), None)
if peer_row is None:
    raise RuntimeError('The missing peer was not preserved in the comparable schedule.')
review = restored_cached['Data Review']
review_row = next((row for row in range(1, review.max_row + 1)
                   if review.cell(row, 1).value == f'peer_{metric}:{peer_ticker}'), None)
formula_errors = [
    f'{sheet.title}!{cell.coordinate}={cell.value}'
    for workbook in (cached, restored_cached, invalid_cached, complete_cached, edited_cached)
    for sheet in workbook.worksheets for row in sheet.iter_rows() for cell in row
    if isinstance(cell.value, str) and cell.value.startswith('#')
]
guard_cells = ('B5', 'B7', 'B8', 'B15', 'B17', 'B19', 'J6', 'K6', 'L6', 'M6')
result = {
    'sheets': formulas.sheetnames,
    'formula_errors': formula_errors,
    'formula_count': sum(1 for sheet in formulas.worksheets for row in sheet.iter_rows()
                         for cell in row if isinstance(cell.value, str) and cell.value.startswith('=')),
    'input_row': input_row,
    'input_value': cached['Input Required'].cell(input_row, 6).value,
    'input_font_rgb': inputs.cell(input_row, 6).font.color.rgb
        if inputs.cell(input_row, 6).font.color and inputs.cell(input_row, 6).font.color.type == 'rgb' else None,
    'input_locked': inputs.cell(input_row, 6).protection.locked,
    'source_required': inputs.cell(input_row, 8).value,
    'status_value': cached['Input Required']['B3'].value,
    'missing_denominator_formula': model[f'{denominator_column}{peer_row}'].value,
    'missing_denominator_value': cached_model[f'{denominator_column}{peer_row}'].value,
    'missing_multiple_formula': model[f'{multiple_column}{peer_row}'].value,
    'missing_multiple_value': cached_model[f'{multiple_column}{peer_row}'].value,
    'guarded_formulas': {cell: model[cell].value for cell in guard_cells},
    'guarded_values': {cell: cached_model[cell].value for cell in guard_cells},
    'restored_status': restored_cached['Input Required']['B3'].value,
    'restored_source_reference': review.cell(review_row, 9).value if review_row is not None else None,
    'restored_review_status': review.cell(review_row, 3).value if review_row is not None else None,
    'restored_values': {cell: restored_cached_model[cell].value for cell in ('B5', 'B7', 'B8', 'B15', 'B17', 'B19')},
    'restored_peer_denominator': restored_cached_model[f'{denominator_column}{peer_row}'].value,
    'restored_peer_multiple': restored_cached_model[f'{multiple_column}{peer_row}'].value,
    'invalid_status': invalid_cached['Input Required']['B3'].value,
    'invalid_values': {cell: invalid_cached['Comparable Valuation'][cell].value for cell in ('B5', 'B7', 'B8', 'B15', 'B17', 'B19')},
    'complete_values': {cell: complete_model[cell].value for cell in ('B4', 'B5', 'B7', 'B8', 'B15', 'B17', 'B19')},
    'edited_formula': edited_formulas['Comparable Valuation']['B8'].value,
    'edited_values': {cell: edited_model[cell].value for cell in ('B4', 'B8', 'B15', 'B17')},
}
print(json.dumps(result))
`;

const inspectIncompleteUtilityWorkbookPython = String.raw`
import json
import subprocess
import sys
from pathlib import Path
from openpyxl import load_workbook

source_path = Path(sys.argv[1])
soffice_path = sys.argv[2]
spec = json.loads(sys.argv[3])
base_year = spec['base_year']
rate_base_additions = spec['rate_base_additions']
rate_base_depreciation = spec['rate_base_depreciation']
source_reference = spec['source_reference']

def input_rows(sheet):
    rows = {}
    for row in range(6, sheet.max_row + 1):
        key = sheet.cell(row, 1).value
        if not key:
            continue
        period = str(sheet.cell(row, 3).value or '')
        rows[(key, period)] = row
    return rows

def create_filled_copy(filename, additions_delta=0, invalid=False):
    workbook = load_workbook(source_path, data_only=False)
    sheet = workbook['Input Required']
    rows = input_rows(sheet)
    base_period = f'FY{base_year}'
    values = {
        ('jurisdictional_rate_base', base_period): spec['base_rate_base'],
        ('allowed_roe', base_period): spec['authorized_roe'],
        ('authorized_equity_ratio', base_period): spec['authorized_equity_ratio'],
        ('dividend_payout_ratio', base_period): spec['dividend_payout_ratio'],
        ('terminal_growth_rate', ''): spec['terminal_growth_rate'],
    }
    for index, year in enumerate(range(base_year + 1, base_year + 6)):
        value = spec['rate_base_additions'][index] + additions_delta
        if invalid and index == 0:
            value = -1
        values[('rate_base_additions', f'FY{year}')] = value
        values[('rate_base_depreciation', f'FY{year}')] = spec['rate_base_depreciation'][index]
    required_sources = 0
    for identity, value in values.items():
        row = rows.get(identity)
        if row is None:
            raise RuntimeError(f'Missing utility input row {identity}.')
        sheet.cell(row, 6).value = value
        if sheet.cell(row, 8).value == 'Yes':
            sheet.cell(row, 7).value = source_reference
            required_sources += 1
    path = source_path.with_name(filename)
    workbook.save(path)
    return path, required_sources

formula_book = load_workbook(source_path, data_only=False)
model_sheet = formula_book['Utility Model']
formula_count = sum(1 for row in model_sheet.iter_rows() for cell in row
                    if isinstance(cell.value, str) and cell.value.startswith('='))
input_sheet = formula_book['Input Required']
rows = input_rows(input_sheet)
missing_input = input_sheet.cell(rows[('jurisdictional_rate_base', f'FY{base_year}')], 6)

restored_path, required_source_count = create_filled_copy('restored_utility.xlsx')
invalid_path, _ = create_filled_copy('invalid_utility.xlsx', invalid=True)
higher_path, _ = create_filled_copy('higher_rate_base_utility.xlsx', additions_delta=1_000_000_000)
recalc_dir = source_path.parent / 'recalculated_utility'
recalc_dir.mkdir(parents=True, exist_ok=True)
process = subprocess.run([
    soffice_path, '--headless', '--convert-to', 'xlsx', '--outdir', str(recalc_dir),
    str(source_path), str(restored_path), str(invalid_path), str(higher_path),
], capture_output=True, text=True, timeout=120)
if process.returncode != 0:
    raise RuntimeError(process.stderr or process.stdout or 'LibreOffice failed to recalculate utility workbooks.')

def load_pair(path):
    converted = recalc_dir / path.name
    return load_workbook(converted, data_only=False), load_workbook(converted, data_only=True)

source_formulas, source_cached = load_pair(source_path)
restored_formulas, restored_cached = load_pair(restored_path)
invalid_formulas, invalid_cached = load_pair(invalid_path)
higher_formulas, higher_cached = load_pair(higher_path)
error_workbooks = (source_cached, restored_cached, invalid_cached, higher_cached)
formula_errors = [
    f'{sheet.title}!{cell.coordinate}={cell.value}'
    for workbook in error_workbooks for sheet in workbook.worksheets
    for row in sheet.iter_rows() for cell in row
    if isinstance(cell.value, str) and cell.value.startswith('#')
]
source_model = source_cached['Utility Model']
restored_model = restored_cached['Utility Model']
invalid_model = invalid_cached['Utility Model']
higher_model = higher_cached['Utility Model']
result = {
    'sheets': formula_book.sheetnames,
    'formula_count': formula_count,
    'formula_errors': formula_errors,
    'model_sheet_protected': formula_book['Utility Model'].protection.sheet,
    'input_sheet_protected': formula_book['Input Required'].protection.sheet,
    'required_input_count': len(values) if 'values' in locals() else len(rows),
    'input_value_blank': source_cached['Input Required'].cell(rows[('jurisdictional_rate_base', f'FY{base_year}')], 6).value is None,
    'input_blue': missing_input.font.color.rgb if missing_input.font.color and missing_input.font.color.type == 'rgb' else None,
    'input_locked': missing_input.protection.locked,
    'status_formula': formula_book['Input Required']['B3'].value,
    'incomplete_status': source_cached['Input Required']['B3'].value,
    'incomplete_outputs': [source_model[cell].value for cell in ('B26', 'B27', 'B28', 'B29', 'B31', 'B33')],
    'formula_cells': {cell: formula_book['Utility Model'][cell].value for cell in ('B24', 'B26', 'B27', 'B29', 'B31', 'B33', 'C9', 'C12', 'C17', 'C19', 'C21')},
    'restored_status': restored_cached['Input Required']['B3'].value,
    'restored_review_status': next((restored_cached['Data Review'].cell(row, 3).value
        for row in range(1, restored_cached['Data Review'].max_row + 1)
        if restored_cached['Data Review'].cell(row, 1).value == 'jurisdictional_rate_base'), None),
    'restored_equity_value_millions': restored_model['B29'].value,
    'restored_per_share': restored_model['B31'].value,
    'restored_sensitivity_center': restored_model['E39'].value,
    'restored_model_values': {cell: restored_model[cell].value for cell in ('B6', 'C8', 'C9', 'C10', 'C11', 'C13', 'C15', 'C16', 'C17', 'C18', 'C19', 'C20', 'C21', 'B24', 'B25', 'B26', 'B27', 'B28', 'B29', 'B30', 'B31', 'B32', 'B33')},
    'invalid_status': invalid_cached['Input Required']['B3'].value,
    'invalid_outputs': [invalid_model[cell].value for cell in ('B26', 'B27', 'B28', 'B29', 'B31', 'B33')],
    'higher_equity_value_millions': higher_model['B29'].value,
    'required_source_count': required_source_count,
}
print(json.dumps(result))
`;

function sanitizedOutput(value: string): string {
  return value
    .replace(/\b[\w.+-]+@[\w.-]+\.\w+\b/g, '[redacted email]')
    .replace(/EDGAR_IDENTITY[^\n]*/g, 'EDGAR_IDENTITY configured');
}

function inspectBiotechPipelineScope(outputPath: string): {
  pipelineAssetIds: string[];
  inputKeys: string[];
  programFacts: Record<string, {reportedFacts: string; sourceBasis: string}>;
  discountFactorLabel: string;
  aggregatePipelineCashflowLabel: string;
} {
  const python = String.raw`
import json
import sys
from openpyxl import load_workbook

workbook = load_workbook(sys.argv[1], data_only=False, read_only=True)
pipeline = workbook['Pipeline Valuation']
inputs = workbook['Input Required']
asset_ids = [str(pipeline.cell(row, 1).value) for row in range(6, pipeline.max_row + 1)
    if isinstance(pipeline.cell(row, 1).value, str) and pipeline.cell(row, 1).value.lower().startswith('mrna-')]
input_keys = [str(inputs.cell(row, 1).value) for row in range(6, inputs.max_row + 1) if inputs.cell(row, 1).value]
program_facts = {}
for asset_id in ('mRNA-4157', 'mRNA-1011'):
    row = next((row for row in range(6, pipeline.max_row + 1) if pipeline.cell(row, 1).value == asset_id), None)
    if row is not None:
        program_facts[asset_id] = {
            'reportedFacts': str(pipeline.cell(row, 3).value or ''),
            'sourceBasis': str(pipeline.cell(row, 4).value or ''),
        }
print(json.dumps({
    'pipelineAssetIds': asset_ids,
    'inputKeys': input_keys,
    'programFacts': program_facts,
    'discountFactorLabel': str(pipeline['O3'].value or ''),
    'aggregatePipelineCashflowLabel': str(pipeline['O4'].value or ''),
}))
`;
  const result = spawnSync(pythonPath, ['-c', python, outputPath], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    timeout: 30_000,
  });
  if (result.status !== 0) {
    throw new Error(`Biotech pipeline scope inspection failed: ${sanitizedOutput(result.stderr || result.stdout || 'unknown error')}`);
  }
  return JSON.parse(result.stdout) as ReturnType<typeof inspectBiotechPipelineScope>;
}

function inspectIncompleteBiotechWorkbook(outputPath: string): {
  sheets: string[];
  formulaCount: number;
  modelProtected: boolean;
  inputProtected: boolean;
  firstInputBlank: boolean;
  firstInputBlue: string | null;
  firstInputLocked: boolean;
  amountMultiplier: number;
  blankStatus: unknown;
  blankModelStatus: unknown;
  blankOutputs: unknown[];
  invalidStatus: unknown;
  invalidIncludeReviewStatus: unknown;
  invalidOutputs: unknown[];
  restoredStatus: unknown;
  restoredReviewStatus: unknown;
  restoredEquityValue: number | null;
  restoredPerShare: number | null;
  sensitivityCenter: number | null;
  sensitivityLowerWacc: number | null;
  sensitivityHigherWacc: number | null;
  sensitivityHigherGrowth: number | null;
  excludedDetailedRnpv: number | null;
  includedOtherAssetRnpv: number | null;
  excludedOtherAssetRnpv: number | null;
  editedPerShare: number | null;
  formulaErrors: string[];
  engineAssumptions: BiotechRnpvAssumptions;
} {
  const python = String.raw`
import json
import subprocess
import sys
from pathlib import Path
from openpyxl import load_workbook

source_path = Path(sys.argv[1])
soffice_path = sys.argv[2]
profile = source_path.parent / 'libreoffice-profile-biotech'
profile.mkdir(parents=True, exist_ok=True)
recalc_dir = source_path.parent / 'recalculated-biotech'
recalc_dir.mkdir(parents=True, exist_ok=True)
scope = load_workbook(source_path, data_only=False)
inputs = scope['Input Required']
model = scope['Biotech Model']
pipeline = scope['Pipeline Valuation']
base_year = int(model['B9'].value) - 1

def rows_by_key(sheet):
    rows = {}
    for row in range(6, sheet.max_row + 1):
        key = sheet.cell(row, 1).value
        if not key:
            continue
        period = str(sheet.cell(row, 3).value or '')
        rows[(str(key), period)] = row
    return rows

input_rows = rows_by_key(inputs)
def find_input(key, period=''):
    row = input_rows.get((key, period))
    if row is None:
        raise RuntimeError(f'Missing required biotech input row {(key, period)}.')
    return row

def value_for(key, period=''):
    return inputs.cell(find_input(key, period), 6).value

all_assets = [
    str(pipeline.cell(row, 1).value)
    for row in range(6, pipeline.max_row + 1)
    if isinstance(pipeline.cell(row, 1).value, str)
    and pipeline.cell(row, 1).value.lower().startswith('mrna-')
]
detail_end = max(row for row in range(6, pipeline.max_row + 1)
    if isinstance(pipeline.cell(row, 1).value, str)
    and pipeline.cell(row, 1).value.lower().startswith('mrna-')
    and pipeline.cell(row, 2).value is not None
    and row < next((candidate for candidate in range(6, pipeline.max_row + 1)
        if pipeline.cell(candidate, 1).value == 'Other SEC-listed assets — source-mapped rNPV inputs'), pipeline.max_row + 1))
detail_rows = {str(pipeline.cell(row, 1).value): row for row in range(6, detail_end + 1)}
other_section = next((row for row in range(6, pipeline.max_row + 1)
    if pipeline.cell(row, 1).value == 'Other SEC-listed assets — source-mapped rNPV inputs'), None)
if other_section is None:
    raise RuntimeError('The workbook is missing its other SEC-listed asset inventory.')
other_header = other_section + 1
other_rows = {str(pipeline.cell(row, 1).value): row for row in range(other_header + 1, pipeline.max_row + 1)
    if isinstance(pipeline.cell(row, 1).value, str) and pipeline.cell(row, 1).value.lower().startswith('mrna-')}
if 'mRNA-1011' not in other_rows or 'mRNA-4157' not in detail_rows:
    raise RuntimeError('The paused and late-stage MRNA programs are not both mapped to the workbook.')

def make_copy(filename, invalid=False, exclude_detail=False, exclude_other=False, formula_edit=False):
    workbook = load_workbook(source_path, data_only=False)
    sheet = workbook['Input Required']
    rows = rows_by_key(sheet)
    values = {}
    def set_value(key, value, period=''):
        row = rows.get((key, period))
        if row is None:
            raise RuntimeError(f'Missing required biotech input {(key, period)}.')
        sheet.cell(row, 6).value = value
        sheet.cell(row, 7).value = 'QA scenario only; not company guidance.'
        values[(key, period)] = value

    for (key, period), row in rows.items():
        if key == 'commercial_revenue_growth':
            set_value(key, 0.06, period)
        elif key == 'commercial_fcf_margin':
            set_value(key, 0.18, period)
        elif key == 'biotech_cost_of_debt':
            set_value(key, 0.04, period)
        elif key == 'biotech_normalized_tax_rate':
            set_value(key, 0.21, period)
        elif key == 'terminal_growth_rate':
            set_value(key, 0.02, period)
        elif key == 'unmapped_pipeline_rnpv':
            set_value(key, 0, period)
        elif key.startswith('asset_'):
            pieces = key.split(':', 1)
            suffix = pieces[0][6:]
            asset_id = pieces[1] if len(pieces) > 1 else ''
            configured = {
                'include': 0.5 if invalid and asset_id.lower() == 'mrna-4157' else 0 if exclude_detail and asset_id.lower() == 'mrna-4157' else 1,
                'launch_year': base_year + 1,
                'peak_sales': 1_500_000_000,
                'years_to_peak': 3,
                'exclusivity_year': base_year + 12,
                'post_loe_erosion': 0.6,
                'probability_of_success': 1.01 if invalid and asset_id.lower() == 'mrna-4157' else 0.35,
                'retained_share': 0.7,
                'contribution_margin': 0.25,
                'development_cost_pv': 25_000_000,
                'scope_include': 0 if exclude_other and asset_id.lower() == 'mrna-1011' else 1,
                'scope_rnpv': 50_000_000,
            }
            if suffix not in configured:
                raise RuntimeError(f'Unexpected biotech assumption key {key}.')
            set_value(key, configured[suffix], period)
        else:
            raise RuntimeError(f'Unexpected required biotech input key {key}.')
    if formula_edit:
        workbook['Biotech Model']['B11'] = '=IF($B$4<>"READY","",$B$6*(1+B10)+1000)'
    path = source_path.with_name(filename)
    workbook.save(path)
    return path, values

restored_path, values = make_copy('restored_biotech.xlsx')
invalid_path, _ = make_copy('invalid_biotech.xlsx', invalid=True)
excluded_path, _ = make_copy('excluded_biotech.xlsx', exclude_detail=True)
excluded_other_path, _ = make_copy('excluded_other_biotech.xlsx', exclude_other=True)
edited_path, _ = make_copy('formula_edited_biotech.xlsx', formula_edit=True)
source_paths = [source_path, restored_path, invalid_path, excluded_path, excluded_other_path, edited_path]
process = subprocess.run([
    soffice_path, '--headless', f'-env:UserInstallation={profile.as_uri()}', '--convert-to', 'xlsx',
    '--outdir', str(recalc_dir), *[str(path) for path in source_paths],
], capture_output=True, text=True, timeout=180)
if process.returncode != 0:
    raise RuntimeError(process.stderr or process.stdout or 'LibreOffice failed to recalculate biotech workbooks.')

def load_pair(path):
    converted = recalc_dir / path.name
    return load_workbook(converted, data_only=False), load_workbook(converted, data_only=True)

blank_formulas, blank_cached = load_pair(source_path)
restored_formulas, restored_cached = load_pair(restored_path)
invalid_formulas, invalid_cached = load_pair(invalid_path)
excluded_formulas, excluded_cached = load_pair(excluded_path)
excluded_other_formulas, excluded_other_cached = load_pair(excluded_other_path)
edited_formulas, edited_cached = load_pair(edited_path)
all_cached = (blank_cached, restored_cached, invalid_cached, excluded_cached, excluded_other_cached, edited_cached)
formula_errors = [
    f'{book.sheetnames[0]}:{sheet.title}!{cell.coordinate}={cell.value}'
    for book in all_cached for sheet in book.worksheets
    for row in sheet.iter_rows() for cell in row
    if isinstance(cell.value, str) and cell.value.startswith('#')
]
blank_model = blank_cached['Biotech Model']
restored_model = restored_cached['Biotech Model']
invalid_model = invalid_cached['Biotech Model']
excluded_pipeline = excluded_cached['Pipeline Valuation']
excluded_other_pipeline = excluded_other_cached['Pipeline Valuation']
edited_model = edited_cached['Biotech Model']
source_formulas = load_workbook(source_path, data_only=False)
source_input = source_formulas['Input Required']
first_growth_row = find_input('commercial_revenue_growth', f'FY{base_year + 1}')
input_cell = source_input.cell(first_growth_row, 6)
first_asset_id = 'mRNA-4157'
detail_row = detail_rows[first_asset_id]
other_row = other_rows['mRNA-1011']
unit_label = str(source_formulas['Biotech Model']['A5'].value)
amount_multiplier = 1_000_000 if 'USD millions' in unit_label else 1_000_000_000 if 'USD billions' in unit_label else 1_000 if 'USD thousands' in unit_label else 1
forecast_years = list(range(base_year + 1, base_year + 11))
assets = []
for asset_id, row in detail_rows.items():
    def asset_input(field):
        return values[(f'asset_{field}:{asset_id}', '')]
    assets.append({
        'assetId': asset_id,
        'include': asset_input('include'),
        'launchYear': asset_input('launch_year'),
        'peakSales': asset_input('peak_sales'),
        'yearsToPeak': asset_input('years_to_peak'),
        'exclusivityYear': asset_input('exclusivity_year'),
        'postLoeErosion': asset_input('post_loe_erosion'),
        'probabilityOfSuccess': asset_input('probability_of_success'),
        'retainedShare': asset_input('retained_share'),
        'contributionMargin': asset_input('contribution_margin'),
        'developmentCostPv': asset_input('development_cost_pv'),
    })
other_pipeline_rnpv = values[('unmapped_pipeline_rnpv', '')]
for asset_id in other_rows:
    other_pipeline_rnpv += values[(f'asset_scope_include:{asset_id}', '')] * values[(f'asset_scope_rnpv:{asset_id}', '')]
growth = [values[('commercial_revenue_growth', f'FY{year}') ] for year in forecast_years]
result = {
    'sheets': source_formulas.sheetnames,
    'formulaCount': sum(1 for sheet_name in ('Biotech Model', 'Pipeline Valuation')
        for row in source_formulas[sheet_name].iter_rows() for cell in row
        if isinstance(cell.value, str) and cell.value.startswith('=')),
    'modelProtected': source_formulas['Biotech Model'].protection.sheet,
    'inputProtected': source_formulas['Input Required'].protection.sheet,
    'firstInputBlank': source_input.cell(first_growth_row, 6).value is None,
    'firstInputBlue': input_cell.font.color.rgb if input_cell.font.color and input_cell.font.color.type == 'rgb' else None,
    'firstInputLocked': input_cell.protection.locked,
    'amountMultiplier': amount_multiplier,
    'blankStatus': blank_cached['Input Required']['B3'].value,
    'blankModelStatus': blank_model['B4'].value,
    'blankOutputs': [blank_model[cell].value for cell in ('M21', 'M22', 'M23', 'M24', 'M25', 'M31', 'M33', 'M35')],
    'invalidStatus': invalid_cached['Input Required']['B3'].value,
    'invalidIncludeReviewStatus': next((invalid_cached['Data Review'].cell(row, 3).value
        for row in range(5, invalid_cached['Data Review'].max_row + 1)
        if invalid_cached['Data Review'].cell(row, 1).value == 'asset_include:mRNA-4157'), None),
    'invalidOutputs': [invalid_model[cell].value for cell in ('M21', 'M22', 'M23', 'M24', 'M25', 'M31', 'M33', 'M35')],
    'restoredStatus': restored_cached['Input Required']['B3'].value,
    'restoredReviewStatus': all(restored_cached['Data Review'].cell(row, 3).value == 'READY'
        for row in range(5, restored_cached['Data Review'].max_row + 1)),
    'restoredEquityValue': restored_model['M31'].value,
    'restoredPerShare': restored_model['M33'].value,
    'sensitivityCenter': restored_model['D43'].value,
    'sensitivityLowerWacc': restored_model['D42'].value,
    'sensitivityHigherWacc': restored_model['D44'].value,
    'sensitivityHigherGrowth': restored_model['E43'].value,
    'excludedDetailedRnpv': excluded_pipeline[f'O{detail_row}'].value,
    'includedOtherAssetRnpv': restored_cached['Pipeline Valuation'][f'G{other_row}'].value,
    'excludedOtherAssetRnpv': excluded_other_cached['Pipeline Valuation'][f'G{other_row}'].value,
    'editedPerShare': edited_model['M33'].value,
    'formulaErrors': formula_errors,
    'engineAssumptions': {
        'baseYear': base_year,
        'commercialRevenueBase': source_formulas['Biotech Model']['B6'].value * amount_multiplier,
        'commercialRevenueGrowth': growth,
        'commercialFcfMargin': values[('commercial_fcf_margin', '')],
        'otherPipelineRnpv': other_pipeline_rnpv,
        'terminalGrowthRate': values[('terminal_growth_rate', '')],
        'riskFreeRate': source_formulas['Biotech Model']['M5'].value,
        'equityRiskPremium': source_formulas['Biotech Model']['M6'].value,
        'beta': source_formulas['Biotech Model']['M7'].value,
        'costOfDebt': values[('biotech_cost_of_debt', '')],
        'normalizedTaxRate': values[('biotech_normalized_tax_rate', '')],
        'marketCapitalization': source_formulas['Biotech Model']['M11'].value * amount_multiplier,
        'dilutedShares': source_formulas['Biotech Model']['M32'].value * amount_multiplier,
        'currentPrice': source_formulas['Biotech Model']['M34'].value,
        'cash': source_formulas['Biotech Model']['M26'].value * amount_multiplier,
        'marketableSecurities': source_formulas['Biotech Model']['M27'].value * amount_multiplier,
        'debt': source_formulas['Biotech Model']['M28'].value * amount_multiplier,
        'nonControllingInterest': source_formulas['Biotech Model']['M29'].value * amount_multiplier,
        'preferredEquity': source_formulas['Biotech Model']['M30'].value * amount_multiplier,
        'assets': assets,
    },
}
print(json.dumps(result))
`;
  const result = spawnSync(pythonPath, ['-c', python, outputPath, sofficePath], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 240_000,
  });
  if (result.status !== 0) {
    throw new Error(`Incomplete biotech workbook inspection failed: ${sanitizedOutput(result.stderr || result.stdout || 'unknown error')}`);
  }
  return JSON.parse(result.stdout) as ReturnType<typeof inspectIncompleteBiotechWorkbook>;
}

function assertEdgarIdentityConfigured(): void {
  if (!process.env.EDGAR_IDENTITY?.trim()) {
    throw new Error('Set EDGAR_IDENTITY before running the live DCF checks. Its value is never logged.');
  }
}

function runLiveCli(ticker: string, outputPath: string, home: string) {
  return spawnSync(process.execPath, [launcherPath, ticker, '--output', outputPath], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HOME: home,
      DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
    },
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    timeout: 240_000,
  });
}

function runLibraryCli(args: string[], home: string) {
  return spawnSync(process.execPath, [resolve(projectRoot, 'bin/dcf.mjs'), ...args], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HOME: home,
      DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
    },
    encoding: 'utf8',
    maxBuffer: 3 * 1024 * 1024,
    timeout: 240_000,
  });
}

async function inspectWorkbook(outputPath: string, testCase: LiveCompanyCase): Promise<{
  sheets: string[];
  model_title: string;
  model_timeline_headers: Array<string | null>;
  formula_count: number;
  formula_cells: Record<string, unknown>;
  summary_formula_cells: Record<string, unknown>;
  bridge_formulas: Record<string, unknown>;
  formula_refs: string[];
  input_value: unknown;
  input_is_formula: boolean;
  input_font_rgb: string | null;
  editable_cells: Record<string, {value: unknown; is_formula: boolean; font_rgb: string | null}>;
  data_formula_cells: Record<string, unknown>;
  data_editable_cells: Record<string, {value: unknown; is_formula: boolean; font_rgb: string | null}>;
  latest_actual_nwc_value: unknown;
  first_forecast_nwc_formula: unknown;
  first_forecast_nwc_change_formula: unknown;
  preferred_equity_value: unknown;
  preferred_equity_is_formula: boolean;
  preferred_equity_font_rgb: string | null;
  preferred_equity_label: unknown;
  nwc_driver_label: unknown;
  nwc_driver_comment: string | null;
  review_statuses: string[];
  review_notes: string[];
}> {
  const result = spawnSync(pythonPath, ['-c', inspectWorkbookPython, outputPath, JSON.stringify(testCase)], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    timeout: 30_000,
  });
  if (result.status !== 0) {
    throw new Error(`Workbook inspection failed: ${sanitizedOutput(result.stderr || result.stdout || 'unknown error')}`);
  }
  return JSON.parse(result.stdout) as Awaited<ReturnType<typeof inspectWorkbook>>;
}

async function inspectIncompleteWorkbook(
  outputPath: string,
  capexValue?: number,
  sourceReference = '',
  completeWorkbookPath?: string,
): Promise<{
  sheets: string[];
  status_formula?: unknown;
  status_value?: unknown;
  formula_errors?: string[];
  input_sheet_protected?: boolean;
  review_sheet_protected?: boolean;
  dcf_sheet_protected?: boolean;
  input_value?: unknown;
  input_coordinate?: string;
  input_font_rgb?: string | null;
  input_locked?: boolean;
  review_row?: unknown[];
  dcf_formula_count?: number;
  forecast_formula?: unknown;
  forecast_value?: unknown;
  valuation_values?: unknown[];
  complete_values?: unknown[];
}> {
  const result = spawnSync(pythonPath, [
    '-c', inspectIncompleteWorkbookPython,
    outputPath,
    sofficePath,
    capexValue === undefined ? '' : String(capexValue),
    sourceReference,
    completeWorkbookPath ?? '',
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    timeout: 30_000,
  });
  if (result.status !== 0) {
    throw new Error(`Incomplete workbook inspection failed: ${sanitizedOutput(result.stderr || result.stdout || 'unknown error')}`);
  }
  return JSON.parse(result.stdout) as Awaited<ReturnType<typeof inspectIncompleteWorkbook>>;
}

async function inspectIncompleteBankWorkbook(
  outputPath: string,
  restoreValue?: number,
  sourceReference = '',
  completeWorkbookPath?: string,
): Promise<{
  sheets: string[];
  formula_errors: string[];
  required_input_row?: number;
  input_value?: unknown;
  input_font_rgb?: string | null;
  input_locked?: boolean;
  source_required?: string;
  status_value?: unknown;
  minimum_cet1_input?: unknown;
  minimum_cet1_formula?: unknown;
  equity_value?: unknown;
  per_share?: unknown;
  guarded_formulas?: Record<string, unknown>;
  guarded_values?: Record<string, unknown>;
  data_review_row?: number;
  data_review_values?: unknown[];
  data_review_status?: unknown;
  restored_status?: unknown;
  restored_source_reference?: unknown;
  restored_equity_value?: number | null;
  restored_per_share?: number | null;
  complete_equity_value?: number | null;
  complete_per_share?: number | null;
}> {
  const result = spawnSync(pythonPath, [
    '-c', inspectIncompleteBankWorkbookPython,
    outputPath,
    sofficePath,
    restoreValue === undefined ? '' : String(restoreValue),
    sourceReference,
    completeWorkbookPath ?? '',
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    timeout: 90_000,
  });
  if (result.status !== 0) {
    throw new Error(`Incomplete bank workbook inspection failed: ${sanitizedOutput(result.stderr || result.stdout || 'unknown error')}`);
  }
  return JSON.parse(result.stdout) as Awaited<ReturnType<typeof inspectIncompleteBankWorkbook>>;
}

async function inspectIncompleteInsuranceWorkbook(
  outputPath: string,
  restoreValue?: number,
  sourceReference = '',
  completeWorkbookPath?: string,
): Promise<{
  sheets: string[];
  formula_errors: string[];
  required_input_row?: number;
  input_value?: unknown;
  input_font_rgb?: string | null;
  input_locked?: boolean;
  source_required?: string;
  status_value?: unknown;
  reserve_value?: unknown;
  reserve_formula?: unknown;
  reserve_check?: unknown;
  enterprise_value_note?: unknown;
  guarded_formulas?: Record<string, unknown>;
  guarded_values?: Record<string, unknown>;
  data_review_row?: number;
  data_review_values?: unknown[];
  data_review_status?: unknown;
  restored_status?: unknown;
  restored_source_reference?: unknown;
  restored_equity_value?: number | null;
  restored_per_share?: number | null;
  complete_equity_value?: number | null;
  complete_per_share?: number | null;
}> {
  const result = spawnSync(pythonPath, [
    '-c', inspectIncompleteInsuranceWorkbookPython,
    outputPath,
    sofficePath,
    restoreValue === undefined ? '' : String(restoreValue),
    sourceReference,
    completeWorkbookPath ?? '',
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    timeout: 90_000,
  });
  if (result.status !== 0) {
    throw new Error(`Incomplete P&C workbook inspection failed: ${sanitizedOutput(result.stderr || result.stdout || 'unknown error')}`);
  }
  return JSON.parse(result.stdout) as Awaited<ReturnType<typeof inspectIncompleteInsuranceWorkbook>>;
}

async function inspectIncompleteReitWorkbook(
  outputPath: string,
  restoreValue?: number,
  sourceReference = '',
  completeWorkbookPath?: string,
): Promise<{
  sheets: string[];
  formula_errors: string[];
  required_input_row?: number;
  input_value?: unknown;
  input_font_rgb?: string | null;
  input_locked?: boolean;
  source_required?: string;
  status_value?: unknown;
  growth_value?: unknown;
  growth_formula?: unknown;
  enterprise_value_note?: unknown;
  guarded_formulas?: Record<string, unknown>;
  guarded_values?: Record<string, unknown>;
  data_review_row?: number;
  data_review_values?: unknown[];
  data_review_status?: unknown;
  restored_status?: unknown;
  restored_source_reference?: unknown;
  restored_equity_value?: number | null;
  restored_per_share?: number | null;
  restored_nav_value?: number | null;
  restored_nav_per_share?: number | null;
  complete_equity_value?: number | null;
  complete_per_share?: number | null;
}> {
  const result = spawnSync(pythonPath, [
    '-c', inspectIncompleteReitWorkbookPython,
    outputPath,
    sofficePath,
    restoreValue === undefined ? '' : String(restoreValue),
    sourceReference,
    completeWorkbookPath ?? '',
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    timeout: 90_000,
  });
  if (result.status !== 0) {
    throw new Error(`Incomplete REIT workbook inspection failed: ${sanitizedOutput(result.stderr || result.stdout || 'unknown error')}`);
  }
  return JSON.parse(result.stdout) as Awaited<ReturnType<typeof inspectIncompleteReitWorkbook>>;
}

async function inspectIncompleteMortgageReitWorkbook(
  outputPath: string,
  restoreValue?: number,
  sourceReference = '',
  completeWorkbookPath?: string,
): Promise<{
  sheets: string[];
  formula_errors: string[];
  required_input_row?: number;
  input_value?: unknown;
  input_font_rgb?: string | null;
  input_locked?: boolean;
  source_required?: string;
  status_value?: unknown;
  repo_value?: unknown;
  repo_formula?: unknown;
  spread_check?: unknown;
  enterprise_value_note?: unknown;
  guarded_formulas?: Record<string, unknown>;
  guarded_values?: Record<string, unknown>;
  data_review_row?: number;
  data_review_values?: unknown[];
  data_review_status?: unknown;
  restored_status?: unknown;
  restored_source_reference?: unknown;
  restored_equity_value?: number | null;
  restored_per_share?: number | null;
  complete_equity_value?: number | null;
  complete_per_share?: number | null;
}> {
  const result = spawnSync(pythonPath, [
    '-c', inspectIncompleteMortgageReitWorkbookPython,
    outputPath,
    sofficePath,
    restoreValue === undefined ? '' : String(restoreValue),
    sourceReference,
    completeWorkbookPath ?? '',
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    timeout: 90_000,
  });
  if (result.status !== 0) {
    throw new Error(`Incomplete mortgage REIT workbook inspection failed: ${sanitizedOutput(result.stderr || result.stdout || 'unknown error')}`);
  }
  return JSON.parse(result.stdout) as Awaited<ReturnType<typeof inspectIncompleteMortgageReitWorkbook>>;
}

async function inspectIncompleteAssetManagerWorkbook(
  outputPath: string,
  restoreValue?: number,
  sourceReference = '',
  completeWorkbookPath?: string,
): Promise<{
  sheets: string[];
  formula_errors: string[];
  required_input_row?: number;
  input_value?: unknown;
  input_font_rgb?: string | null;
  input_locked?: boolean;
  source_required?: string;
  status_value?: unknown;
  schedule_input?: unknown;
  schedule_input_formula?: unknown;
  base_fee_yield_assumption?: unknown;
  base_fee_yield_formula?: unknown;
  guarded_formulas?: Record<string, unknown>;
  guarded_values?: Record<string, unknown>;
  data_review_row?: number;
  data_review_values?: unknown[];
  data_review_status?: unknown;
  restored_status?: unknown;
  restored_source_reference?: unknown;
  restored_equity_value?: number | null;
  restored_per_share?: number | null;
  complete_equity_value?: number | null;
  complete_per_share?: number | null;
}> {
  const result = spawnSync(pythonPath, [
    '-c', inspectIncompleteAssetManagerWorkbookPython,
    outputPath,
    sofficePath,
    restoreValue === undefined ? '' : String(restoreValue),
    sourceReference,
    completeWorkbookPath ?? '',
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    timeout: 90_000,
  });
  if (result.status !== 0) {
    throw new Error(`Incomplete asset-manager workbook inspection failed: ${sanitizedOutput(result.stderr || result.stdout || 'unknown error')}`);
  }
  return JSON.parse(result.stdout) as Awaited<ReturnType<typeof inspectIncompleteAssetManagerWorkbook>>;
}

async function inspectIncompleteTelecomWorkbook(
  outputPath: string,
  restoreValue?: number,
  sourceReference = '',
  completeWorkbookPath?: string,
): Promise<{
  sheets: string[];
  formula_errors: string[];
  required_input_row?: number;
  input_value?: unknown;
  input_font_rgb?: string | null;
  input_locked?: boolean;
  source_required?: string;
  status_value?: unknown;
  churn_value?: unknown;
  churn_formula?: unknown;
  gross_add_rate?: unknown;
  gross_add_rate_formula?: unknown;
  churn_assumption?: unknown;
  churn_assumption_formula?: unknown;
  guarded_formulas?: Record<string, unknown>;
  guarded_values?: Record<string, unknown>;
  data_review_row?: number;
  data_review_values?: unknown[];
  data_review_status?: unknown;
  restored_status?: unknown;
  restored_source_reference?: unknown;
  restored_equity_value?: number | null;
  restored_per_share?: number | null;
  complete_equity_value?: number | null;
  complete_per_share?: number | null;
}> {
  const result = spawnSync(pythonPath, [
    '-c', inspectIncompleteTelecomWorkbookPython,
    outputPath,
    sofficePath,
    restoreValue === undefined ? '' : String(restoreValue),
    sourceReference,
    completeWorkbookPath ?? '',
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    timeout: 90_000,
  });
  if (result.status !== 0) {
    throw new Error(`Incomplete telecom workbook inspection failed: ${sanitizedOutput(result.stderr || result.stdout || 'unknown error')}`);
  }
  return JSON.parse(result.stdout) as Awaited<ReturnType<typeof inspectIncompleteTelecomWorkbook>>;
}

async function inspectIncompleteIntegratedEnergyWorkbook(
  outputPath: string,
  restoreValue?: number,
  sourceReference = '',
  completeWorkbookPath?: string,
): Promise<{
  sheets: string[];
  formula_errors: string[];
  required_input_row?: number;
  input_value?: unknown;
  input_font_rgb?: string | null;
  input_locked?: boolean;
  source_required?: string;
  status_value?: unknown;
  production_value?: unknown;
  production_formula?: unknown;
  production_revenue?: unknown;
  production_margin?: unknown;
  conversion_factor?: unknown;
  conversion_factor_formula?: unknown;
  enterprise_value_note?: unknown;
  guarded_formulas?: Record<string, unknown>;
  guarded_values?: Record<string, unknown>;
  data_review_row?: number;
  data_review_values?: unknown[];
  data_review_status?: unknown;
  restored_status?: unknown;
  restored_source_reference?: unknown;
  restored_equity_value?: number | null;
  restored_per_share?: number | null;
  complete_equity_value?: number | null;
  complete_per_share?: number | null;
}> {
  const result = spawnSync(pythonPath, [
    '-c', inspectIncompleteIntegratedEnergyWorkbookPython,
    outputPath,
    sofficePath,
    restoreValue === undefined ? '' : String(restoreValue),
    sourceReference,
    completeWorkbookPath ?? '',
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    timeout: 90_000,
  });
  if (result.status !== 0) {
    throw new Error(`Incomplete integrated-energy workbook inspection failed: ${sanitizedOutput(result.stderr || result.stdout || 'unknown error')}`);
  }
  return JSON.parse(result.stdout) as Awaited<ReturnType<typeof inspectIncompleteIntegratedEnergyWorkbook>>;
}

async function inspectIncompleteMaturePharmaWorkbook(
  outputPath: string,
  restoreValue?: number,
  sourceReference = '',
  completeWorkbookPath?: string,
): Promise<{
  sheets: string[];
  formula_errors: string[];
  required_input_row?: number;
  input_value?: unknown;
  input_font_rgb?: string | null;
  input_locked?: boolean;
  source_required?: string;
  status_value?: unknown;
  product_row?: number;
  product_revenue?: unknown;
  product_revenue_formula?: unknown;
  product_growth?: unknown;
  product_growth_formula?: unknown;
  patent_years?: unknown[];
  guarded_formulas?: Record<string, unknown>;
  guarded_values?: Record<string, unknown>;
  data_review_row?: number;
  data_review_values?: unknown[];
  data_review_status?: unknown;
  restored_status?: unknown;
  restored_source_reference?: unknown;
  restored_equity_value?: number | null;
  restored_per_share?: number | null;
  complete_equity_value?: number | null;
  complete_per_share?: number | null;
}> {
  const result = spawnSync(pythonPath, [
    '-c', inspectIncompleteMaturePharmaWorkbookPython,
    outputPath,
    sofficePath,
    restoreValue === undefined ? '' : String(restoreValue),
    sourceReference,
    completeWorkbookPath ?? '',
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    timeout: 120_000,
  });
  if (result.status !== 0) {
    throw new Error(`Incomplete mature-pharma workbook inspection failed: ${sanitizedOutput(result.stderr || result.stdout || 'unknown error')}`);
  }
  return JSON.parse(result.stdout) as Awaited<ReturnType<typeof inspectIncompleteMaturePharmaWorkbook>>;
}

async function inspectIncompleteComparableWorkbook(
  outputPath: string,
  metric: 'ebitda' | 'revenue',
  peerTicker: string,
  restoreValue: number,
  sourceReference: string,
  completeWorkbookPath: string,
): Promise<{
  sheets: string[];
  formula_errors: string[];
  formula_count: number;
  input_row: number;
  input_value: unknown;
  input_font_rgb: string | null;
  input_locked: boolean;
  source_required: string;
  status_value: unknown;
  missing_denominator_formula: unknown;
  missing_denominator_value: unknown;
  missing_multiple_formula: unknown;
  missing_multiple_value: unknown;
  guarded_formulas: Record<string, unknown>;
  guarded_values: Record<string, unknown>;
  restored_status: unknown;
  restored_source_reference: unknown;
  restored_review_status: unknown;
  restored_values: Record<string, unknown>;
  restored_peer_denominator: unknown;
  restored_peer_multiple: unknown;
  invalid_status: unknown;
  invalid_values: Record<string, unknown>;
  complete_values: Record<string, unknown>;
  edited_formula: unknown;
  edited_values: Record<string, unknown>;
}> {
  const result = spawnSync(pythonPath, [
    '-c', inspectIncompleteComparableWorkbookPython,
    outputPath,
    sofficePath,
    metric,
    peerTicker,
    String(restoreValue),
    sourceReference,
    completeWorkbookPath,
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    timeout: 150_000,
  });
  if (result.status !== 0) {
    throw new Error(`Incomplete comparable workbook inspection failed: ${sanitizedOutput(result.stderr || result.stdout || 'unknown error')}`);
  }
  return JSON.parse(result.stdout) as Awaited<ReturnType<typeof inspectIncompleteComparableWorkbook>>;
}

async function inspectIncompleteUtilityWorkbook(
  outputPath: string,
  spec: {
    base_year: number;
    base_rate_base: number;
    authorized_roe: number;
    authorized_equity_ratio: number;
    rate_base_additions: number[];
    rate_base_depreciation: number[];
    dividend_payout_ratio: number;
    terminal_growth_rate: number;
    source_reference: string;
  },
): Promise<{
  sheets: string[];
  formula_count: number;
  formula_errors: string[];
  model_sheet_protected: boolean;
  input_sheet_protected: boolean;
  required_input_count: number;
  input_value_blank: boolean;
  input_blue: string | null;
  input_locked: boolean;
  status_formula: unknown;
  incomplete_status: unknown;
  incomplete_outputs: unknown[];
  formula_cells: Record<string, unknown>;
  restored_status: unknown;
  restored_review_status: unknown;
  restored_equity_value_millions: number | null;
  restored_per_share: number | null;
  restored_sensitivity_center: number | null;
  restored_model_values: Record<string, unknown>;
  invalid_status: unknown;
  invalid_outputs: unknown[];
  higher_equity_value_millions: number | null;
  required_source_count: number;
}> {
  const result = spawnSync(pythonPath, [
    '-c', inspectIncompleteUtilityWorkbookPython,
    outputPath,
    sofficePath,
    JSON.stringify(spec),
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    timeout: 150_000,
  });
  if (result.status !== 0) {
    throw new Error(`Incomplete utility workbook inspection failed: ${sanitizedOutput(result.stderr || result.stdout || 'unknown error')}`);
  }
  return JSON.parse(result.stdout) as Awaited<ReturnType<typeof inspectIncompleteUtilityWorkbook>>;
}

async function inspectIncompleteLifeInsuranceWorkbook(
  outputPath: string,
  spec: {
    ticker: 'MET' | 'PRU';
    risk_free_rate: number;
    equity_risk_premium: number;
    beta: number;
    current_price: number;
    diluted_shares: number;
  },
): Promise<{
  sheets: string[];
  formula_count: number;
  model_labels: string[];
  model_formulas: string[];
  input_count: number;
  first_input_blank: boolean;
  first_input_blue: string | null;
  first_input_locked: boolean;
  source_accessions: string[];
  source_unit_scale_values: string[];
  review_freeze_panes: string | null;
  blank_status: unknown;
  blank_model_status: unknown;
  blank_outputs: unknown[];
  missing_source_status: unknown;
  missing_source_review_failed: boolean;
  missing_source_outputs: unknown[];
  blank_center_formula: unknown;
  blank_cost_of_equity_header_formula: unknown;
  blank_terminal_growth_header_formula: unknown;
  blank_formula_errors: string[];
  invalid_status: unknown;
  invalid_outputs: unknown[];
  restored_status: unknown;
  restored_review_ready: boolean;
  restored_equity_value_millions: number | null;
  restored_per_share: number | null;
  sensitivity_center: number | null;
  higher_retention_per_share: number | null;
  lower_upstream_per_share: number | null;
  capital_release_per_share: number | null;
  cash_below_reserve_input_status: unknown;
  cash_below_reserve_model_status: unknown;
  cash_below_reserve_outputs: unknown[];
  negative_cash_input_status: unknown;
  negative_cash_model_status: unknown;
  negative_cash_terminal_distributable: number | null;
  negative_cash_outputs: unknown[];
  formula_edited_per_share: number | null;
  restored_test_segment_forecast: number | null;
  edited_test_segment_forecast: number | null;
  restored_test_segment_formula: unknown;
  edited_test_segment_formula: unknown;
  formula_errors: string[];
  required_source_count: number;
}> {
  const python = String.raw`
import json
import subprocess
import sys
from pathlib import Path
from openpyxl import load_workbook

source_path = Path(sys.argv[1])
soffice_path = sys.argv[2]
spec = json.loads(sys.argv[3])
source = load_workbook(source_path, data_only=False)
source_model = source['Life Insurance Model']
source_inputs = source['Input Required']
input_rows = [row for row in range(6, source_inputs.max_row + 1) if source_inputs.cell(row, 1).value]
first_input = source_inputs.cell(input_rows[0], 6) if input_rows else None
review = source['Data Review']
source_accessions = sorted({
    str(cell.value)
    for row in review.iter_rows()
    for cell in row
    if isinstance(cell.value, str) and '000' in cell.value and len(cell.value) >= 18
})
source_unit_scale_values = sorted({
    str(cell.value)
    for row in review.iter_rows()
    for cell in row
    if cell.value == 'millions'
})
model_labels = [
        str(cell.value) for row in source_model.iter_rows() for cell in row
        if isinstance(cell.value, str) and not cell.value.startswith('=')
]
model_formulas = [
        str(cell.value) for row in source_model.iter_rows() for cell in row
        if isinstance(cell.value, str) and cell.value.startswith('=')
]

def input_map(sheet):
    return {
        (str(sheet.cell(row, 1).value), str(sheet.cell(row, 3).value or '')): row
        for row in range(6, sheet.max_row + 1)
        if sheet.cell(row, 1).value
    }

def make_copy(filename, capital_addition=500_000_000, upstream_capacity=8_000_000_000, invalid=False, formula_edit=False, parent_cash_below_reserve=False, omit_sources=False):
    workbook = load_workbook(source_path, data_only=False)
    model = workbook['Life Insurance Model']
    inputs = workbook['Input Required']
    rows = input_map(inputs)
    required_sources = 0
    for (key, period), row in rows.items():
        if key.startswith('life_segment_earnings_growth:'):
            value = 0.04
        elif key == 'life_net_capital_addition':
            value = capital_addition
        elif key == 'life_permitted_upstream_dividends':
            value = upstream_capacity
        elif key == 'life_parent_cash':
            value = 1_000_000_000 if parent_cash_below_reserve else 3_000_000_000
        elif key == 'life_parent_cash_reserve':
            value = 2_000_000_000
        elif key == 'life_parent_debt':
            value = 500_000_000
        elif key in {'life_preferred_equity', 'life_non_controlling_interest'}:
            value = 0
        elif key == 'life_normalized_tax_rate':
            value = 0.25
        elif key == 'terminal_growth_rate':
            value = 0.11 if invalid else 0.02
        elif key == 'life_risk_free_rate':
            value = spec['risk_free_rate']
        elif key == 'life_equity_risk_premium':
            value = spec['equity_risk_premium']
        elif key == 'life_beta':
            value = spec['beta']
        elif key == 'life_current_share_price':
            value = spec['current_price']
        elif key == 'life_diluted_shares':
            value = spec['diluted_shares']
        else:
            raise RuntimeError(f'Unexpected life-insurance input: {(key, period)}')
        inputs.cell(row, 6).value = value
        if inputs.cell(row, 8).value == 'Yes':
            if not omit_sources:
                inputs.cell(row, 7).value = 'Live integration scenario for workbook QA only; not company guidance.'
            required_sources += 1
    if formula_edit:
        segment_row = next(
            row for row in range(10, model.max_row + 1)
            if isinstance(model.cell(row, 1).value, str) and model.cell(row, 1).value.startswith('Group Benefits —' if spec['ticker'] == 'MET' else 'Group Insurance —')
        )
        growth_row = segment_row + 1
        model[f'E{segment_row}'] = f"=IF('Input Required'!$B$3<>\"READY\",\"\",D{segment_row}*(1+E{growth_row})+1000)"
    path = source_path.with_name(filename)
    workbook.save(path)
    return path, required_sources

restored_path, required_source_count = make_copy('restored_life_insurance.xlsx')
missing_source_path, _ = make_copy('missing_source_life_insurance.xlsx', omit_sources=True)
invalid_path, _ = make_copy('invalid_life_insurance.xlsx', invalid=True)
retention_path, _ = make_copy('higher_retention_life_insurance.xlsx', capital_addition=4_800_000_000)
upstream_path, _ = make_copy('lower_upstream_life_insurance.xlsx', upstream_capacity=1_000_000_000)
release_path, _ = make_copy('capital_release_life_insurance.xlsx', capital_addition=-500_000_000)
cash_gap_path, _ = make_copy('parent_cash_below_reserve_life_insurance.xlsx', parent_cash_below_reserve=True)
negative_path, _ = make_copy('negative_distributable_life_insurance.xlsx', capital_addition=8_000_000_000)
edited_path, _ = make_copy('formula_edited_life_insurance.xlsx', formula_edit=True)
recalc_dir = source_path.parent / 'recalculated_life_insurance'
recalc_dir.mkdir(parents=True, exist_ok=True)
profile = source_path.parent / 'libreoffice-profile-life-insurance'
profile.mkdir(parents=True, exist_ok=True)
process = subprocess.run([
    soffice_path, '--headless', f'-env:UserInstallation={profile.as_uri()}', '--convert-to', 'xlsx',
    '--outdir', str(recalc_dir), str(source_path), str(restored_path), str(invalid_path),
    str(missing_source_path), str(retention_path), str(upstream_path), str(release_path), str(cash_gap_path), str(negative_path), str(edited_path),
], capture_output=True, text=True, timeout=180)
if process.returncode != 0:
    raise RuntimeError(process.stderr or process.stdout or 'LibreOffice failed to recalculate life-insurance workbooks.')

def pair(path):
    converted = recalc_dir / path.name
    return load_workbook(converted, data_only=False), load_workbook(converted, data_only=True)

blank_formulas, blank_values = pair(source_path)
restored_formulas, restored_values = pair(restored_path)
missing_source_formulas, missing_source_values = pair(missing_source_path)
invalid_formulas, invalid_values = pair(invalid_path)
retention_formulas, retention_values = pair(retention_path)
upstream_formulas, upstream_values = pair(upstream_path)
release_formulas, release_values = pair(release_path)
cash_gap_formulas, cash_gap_values = pair(cash_gap_path)
negative_formulas, negative_values = pair(negative_path)
edited_formulas, edited_values = pair(edited_path)

def row_with_label(sheet, label):
    return next(row for row in range(1, sheet.max_row + 1) if sheet.cell(row, 1).value == label)

def output_value(values, label):
    model = values['Life Insurance Model']
    return model.cell(row_with_label(model, label), 2).value

def formula_errors(*workbooks):
    return [
        f'{sheet.title}!{cell.coordinate}={cell.value}'
        for workbook in workbooks for sheet in workbook.worksheets
        for row in sheet.iter_rows() for cell in row
        if isinstance(cell.value, str) and cell.value.startswith('#')
    ]

sens_row = row_with_label(restored_formulas['Life Insurance Model'], 'Per-share sensitivity — cost of equity and terminal growth')
center = restored_values['Life Insurance Model'][f'D{sens_row + 4}'].value
review_statuses = [
    restored_values['Data Review'].cell(row, 3).value
    for row in range(5, 5 + len(input_rows))
]
missing_source_statuses = [
    missing_source_values['Data Review'].cell(row, 3).value
    for row in range(5, 5 + len(input_rows))
]
output_labels = ('Common-equity value', 'Implied value per share', 'Terminal value')
edited_segment_prefix = 'Group Benefits —' if spec['ticker'] == 'MET' else 'Group Insurance —'
edited_segment_row = next(row for row in range(10, source_model.max_row + 1)
    if isinstance(source_model.cell(row, 1).value, str) and source_model.cell(row, 1).value.startswith(edited_segment_prefix))
print(json.dumps({
    'sheets': source.sheetnames,
    'formula_count': sum(1 for row in source_model.iter_rows() for cell in row if isinstance(cell.value, str) and cell.value.startswith('=')),
    'model_labels': model_labels,
    'model_formulas': model_formulas,
    'input_count': len(input_rows),
    'first_input_blank': first_input is not None and first_input.value is None,
    'first_input_blue': first_input.font.color.rgb if first_input and first_input.font.color and first_input.font.color.type == 'rgb' else None,
    'first_input_locked': first_input.protection.locked if first_input else None,
    'source_accessions': source_accessions,
    'source_unit_scale_values': source_unit_scale_values,
    'review_freeze_panes': review.freeze_panes,
    'blank_status': blank_values['Input Required']['B3'].value,
    'blank_model_status': blank_values['Life Insurance Model']['B4'].value,
    'blank_outputs': [output_value(blank_values, label) for label in output_labels] + [blank_values['Life Insurance Model'][f'D{sens_row + 4}'].value],
    'missing_source_status': missing_source_values['Input Required']['B3'].value,
    'missing_source_review_failed': any(status == 'SOURCE REQUIRED' for status in missing_source_statuses),
    'missing_source_outputs': [output_value(missing_source_values, label) for label in output_labels],
    'blank_center_formula': blank_formulas['Life Insurance Model'][f'D{sens_row + 4}'].value,
    'blank_cost_of_equity_header_formula': blank_formulas['Life Insurance Model'][f'A{sens_row + 4}'].value,
    'blank_terminal_growth_header_formula': blank_formulas['Life Insurance Model'][f'D{sens_row + 1}'].value,
    'blank_formula_errors': formula_errors(blank_values),
    'invalid_status': invalid_values['Life Insurance Model']['B4'].value,
    'invalid_outputs': [output_value(invalid_values, label) for label in output_labels],
    'restored_status': restored_values['Life Insurance Model']['B4'].value,
    'restored_review_ready': all(status == 'READY' for status in review_statuses),
    'restored_equity_value_millions': output_value(restored_values, 'Common-equity value'),
    'restored_per_share': output_value(restored_values, 'Implied value per share'),
    'sensitivity_center': center,
    'higher_retention_per_share': output_value(retention_values, 'Implied value per share'),
    'lower_upstream_per_share': output_value(upstream_values, 'Implied value per share'),
    'capital_release_per_share': output_value(release_values, 'Implied value per share'),
    'cash_below_reserve_input_status': cash_gap_values['Input Required']['B3'].value,
    'cash_below_reserve_model_status': cash_gap_values['Life Insurance Model']['B4'].value,
    'cash_below_reserve_outputs': [output_value(cash_gap_values, label) for label in output_labels],
    'negative_cash_input_status': negative_values['Input Required']['B3'].value,
    'negative_cash_model_status': negative_values['Life Insurance Model']['B4'].value,
    'negative_cash_terminal_distributable': negative_values['Life Insurance Model'][
        f'I{row_with_label(negative_values["Life Insurance Model"], "Distributable earnings")}'].value,
    'negative_cash_outputs': [output_value(negative_values, label) for label in output_labels],
    'formula_edited_per_share': output_value(edited_values, 'Implied value per share'),
    'restored_test_segment_forecast': restored_values['Life Insurance Model'][f'E{edited_segment_row}'].value,
    'edited_test_segment_forecast': edited_values['Life Insurance Model'][f'E{edited_segment_row}'].value,
    'restored_test_segment_formula': restored_formulas['Life Insurance Model'][f'E{edited_segment_row}'].value,
    'edited_test_segment_formula': edited_formulas['Life Insurance Model'][f'E{edited_segment_row}'].value,
    'formula_errors': formula_errors(blank_values, restored_values, missing_source_values, invalid_values, retention_values, upstream_values, release_values, cash_gap_values, negative_values, edited_values),
    'required_source_count': required_source_count,
}))
`;
  const result = spawnSync(pythonPath, ['-c', python, outputPath, sofficePath, JSON.stringify(spec)], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    timeout: 210_000,
  });
  if (result.status !== 0) {
    throw new Error(`Life-insurance workbook inspection failed: ${sanitizedOutput(result.stderr || result.stdout || 'unknown error')}`);
  }
  return JSON.parse(result.stdout) as Awaited<ReturnType<typeof inspectIncompleteLifeInsuranceWorkbook>>;
}

describe.skipIf(liveUnavailableReason !== null)('live dcfbuild company-model checks', () => {
  for (const testCase of liveCompanyCases) {
    it(`${testCase.ticker} fetches current data and exports its routed formula model`, async () => {
      assertEdgarIdentityConfigured();
      const home = await mkdtemp(join(tmpdir(), `dcfbuild-live-${testCase.ticker.toLowerCase()}-`));
      const outputPath = join(home, `${testCase.ticker.toLowerCase()}_dcf.xlsx`);

      try {
        const result = runLiveCli(testCase.ticker, outputPath, home);
        if (result.error) throw new Error(`Live dcfbuild failed (${result.error.name}).`);
        const output = sanitizedOutput(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
        if (['T', 'AGNC'].includes(testCase.ticker)
          && result.status !== 0 && output.includes('usd_reporting_currency')) {
          expect(output).toContain(testCase.ticker);
          await expect(access(outputPath)).rejects.toThrow();
          return;
        }
        expect(result.status, output).toBe(0);
        expect(output).toContain(testCase.ticker);
        const requiredSourceSections = testCase.modelSheet === 'Comparable Valuation'
          ? ['market', 'peers']
          : ['market', 'valuation_context'];
        for (const section of requiredSourceSections) {
          expect(output, `${testCase.ticker} has a current ${section} source`)
            .not.toMatch(new RegExp(`Warning: ${section}: data status is (cached|stale|default|unavailable)`, 'i'));
        }
        const workbookBytes = await readFile(outputPath);
        expect(workbookBytes.subarray(0, 2)).toEqual(Buffer.from('PK'));
        expect(workbookBytes.byteLength).toBeGreaterThan(10_000);
        expect((await stat(join(home, 'financial_cache.sqlite'))).isFile()).toBe(true);

        const workbook = await inspectWorkbook(outputPath, testCase);
        expect(workbook.sheets).toContain('Data Review');
        expect(workbook.formula_count).toBeGreaterThan(testCase.ticker === 'AAPL' ? 1_000 : 5);
        expect(workbook.formula_refs).toEqual([]);
        expect(workbook.input_is_formula).toBe(false);
        expect(workbook.input_font_rgb?.slice(-6)).toBe('0000FF');
        if (!['AGNC', 'XOM', 'PFE'].includes(testCase.ticker)) expect(workbook.review_statuses).toContain('INFO');
        for (const [cell, formula] of Object.entries(workbook.formula_cells)) {
          expect(typeof formula, `${testCase.modelSheet}!${cell}`).toBe('string');
          expect(String(formula).startsWith('='), `${testCase.modelSheet}!${cell}`).toBe(true);
        }
        if (testCase.ticker === 'AAPL') {
          for (const [cell, detail] of Object.entries(workbook.editable_cells)) {
            expect(detail.is_formula, `${cell} is an editable operating DCF assumption`).toBe(false);
            expect(detail.font_rgb?.slice(-6), `${cell} is styled as an editable operating DCF assumption`).toBe('0000FF');
          }
          for (const [cell, detail] of Object.entries(workbook.data_editable_cells)) {
            expect(detail.is_formula, `Data Given (Recalculated)!${cell} is an editable working-capital input`).toBe(false);
            expect(detail.font_rgb?.slice(-6), `Data Given (Recalculated)!${cell} is styled as an editable working-capital input`).toBe('0000FF');
          }
          expect(String(workbook.formula_cells.M24)).toContain('$F$16');
          expect(String(workbook.formula_cells.M45)).toContain('M53');
          expect(String(workbook.formula_cells.M65)).toContain('$F$9');
          for (const reference of ['$C$50', '$C$51', '$C$52', '$F$10']) {
            expect(String(workbook.formula_cells.M77)).toContain(reference);
          }
          expect(workbook.formula_cells.M78).toBe('=SUM(M74:M77)');
          expect(workbook.formula_cells.M83).toBe('=1');
          expect(workbook.formula_cells.Q83).toBe('=P83+1');
          expect(workbook.data_formula_cells.C53).toBe("='DCF Model - Base (1)'!$F$10");
          expect(String(workbook.formula_cells.C12)).toContain('-F20');
          expect(String(workbook.formula_cells.C12)).toContain('-F21');
          expect(workbook.formula_cells.Q96).toBe('=-$F$20-$F$21');
          expect(String(workbook.formula_cells.Q97)).toContain('$AA$17');
          expect(String(workbook.formula_cells.Q97)).toContain('$AA$19');
          expect(String(workbook.bridge_formulas.D37)).toContain('$F$20');
          expect(String(workbook.bridge_formulas.D37)).toContain('$F$21');
          expect(String(workbook.bridge_formulas.D38)).toContain('$AA$17');
          expect(String(workbook.bridge_formulas.D38)).toContain('$AA$19');
          expect(workbook.bridge_formulas.D40).toBe('=SUM(D35:D38)');
          expect(workbook.review_notes.some((note) => note.includes('stockBasedComp') && note.includes('were summed'))).toBe(false);
          expect(workbook.preferred_equity_label).toBe('Preferred Equity');
          expect(workbook.preferred_equity_value).toBe(0);
          expect(workbook.preferred_equity_is_formula).toBe(false);
          expect(workbook.preferred_equity_font_rgb?.slice(-6)).toBe('0000FF');
          expect(workbook.review_notes.some((note) => note.includes('no_preferred_stock_fact_disclosed_in_filed_10k'))).toBe(true);
          expect(workbook.review_notes.some((note) =>
            note.includes('Cost of debt')
            && note.includes('SEC accession')
            && note.includes('not a weighted-average yield for all outstanding debt')
          ) || workbook.review_notes.some((note) =>
            note.includes('Cost of debt: absolute')
            && note.includes('average FY')
            && note.includes('accession')
          ), 'AAPL WACC discloses the source and method for cost of debt').toBe(true);
          expect(workbook.review_notes.some((note) =>
            note.includes('Terminal exit multiple uses') && note.includes('current market-implied')
          ) || workbook.review_notes.some((note) => note.includes('Terminal exit multiple is the median current EV/EBITDA')),
          'AAPL terminal multiple has a visible current-market or peer source').toBe(true);
          expect(workbook.review_notes.some((note) =>
            note.includes('RevenueFromContractWithCustomerExcludingAssessedTax')
            && /FY\s+20\d{2}/.test(note)
            && /accession\s+\d{10}-\d{2}-\d{6}/.test(note)
            && /filed\s+20\d{2}-\d{2}-\d{2}/.test(note)
            && note.includes('unit USD')
            && note.includes('actual')
          ), 'AAPL workbook source review includes concept, accession, filed date, currency unit, and scale').toBe(true);
          expect(workbook.review_notes.some((note) =>
            note.includes('lease expense remains in EBIT/FCFF')
            && note.includes('not deducted again in the enterprise-to-common-equity bridge')
          ), 'AAPL workbook discloses its operating-lease bridge treatment').toBe(true);
          expect(workbook.review_notes.some((note) =>
            note.includes('Revenue growth is initialized from the filed revenue history')
            && note.includes('not issuer guidance')
          ), 'AAPL workbook labels historical-derived growth as an analyst starting assumption').toBe(true);
        }

        if (testCase.ticker === 'CRM') {
          expect(workbook.nwc_driver_label).toBe('Aggregate operating NWC residual % of Revenue');
          expect(workbook.editable_cells.F10?.is_formula).toBe(false);
          expect(workbook.editable_cells.F10?.font_rgb?.slice(-6)).toBe('0000FF');
          expect(workbook.editable_cells.F10?.value).not.toBe(0);
          expect(workbook.review_notes.some((note) => note.includes('remaining balance is an editable aggregate working-capital residual'))).toBe(true);
          expect(typeof workbook.latest_actual_nwc_value).toBe('number');
          expect(workbook.latest_actual_nwc_value as number).toBeLessThan(0);
          expect(String(workbook.first_forecast_nwc_formula)).toContain('$C$53');
          expect(workbook.first_forecast_nwc_change_formula).toBe('=L40-K40');
        }

        if (['CRM', 'WMT'].includes(testCase.ticker)) {
          expect(String(workbook.formula_cells.M24)).toContain('$F$16');
          expect(String(workbook.formula_cells.M45)).toContain('M53');
          expect(String(workbook.formula_cells.M65)).toContain('$F$9');
          for (const reference of ['$C$50', '$C$51', '$C$52', '$F$10']) {
            expect(String(workbook.formula_cells.M77)).toContain(reference);
          }
          expect(workbook.formula_cells.M78).toBe('=SUM(M74:M77)');
          for (const cell of ['F9', 'F10', 'F11', 'F13', 'F14', 'F15', 'F16', 'F17', 'F19', 'I13', 'I14', 'I15']) {
            expect(workbook.editable_cells[cell]?.is_formula, `${cell} remains an editable driver`).toBe(false);
            expect(workbook.editable_cells[cell]?.font_rgb?.slice(-6), `${cell} is marked as editable`).toBe('0000FF');
          }
        }

        if (['AAPL', 'CRM', 'WMT'].includes(testCase.ticker)) {
          expect(workbook.formula_cells.M21).toBe('=$F$14+($F$19-$F$14)*MAX(0,MIN(1,(M$83-$I$14)/$I$15))');
          expect(workbook.formula_cells.O21).toBe('=$F$14+($F$19-$F$14)*MAX(0,MIN(1,(O$83-$I$14)/$I$15))');
          expect(workbook.formula_cells.Q21).toBe('=$F$14+($F$19-$F$14)*MAX(0,MIN(1,(Q$83-$I$14)/$I$15))');
          expect(workbook.formula_cells.M20).toBe('=L20*(1+M21)');
          expect(workbook.formula_cells.M53).toBe('=IF(M$83<$I$13,$F$15+($F$17-$F$15)*M$83/$I$13,$F$17)');
          expect(workbook.formula_cells.Q53).toBe('=IF(Q$83<$I$13,$F$15+($F$17-$F$15)*Q$83/$I$13,$F$17)');
          expect(workbook.formula_cells.M45).toBe('=M32-M36-M39-M20*M53');
          expect(workbook.formula_cells.Q45).toBe('=Q32-Q36-Q39-Q20*Q53');
          expect(workbook.formula_cells.C13).toBe('=Q111/$I$16');
          expect(workbook.formula_cells.C14).toBe('=C12/$I$16');
          expect(workbook.data_formula_cells.L12).toBe("='DCF Model - Base (1)'!M20");
          expect(workbook.summary_formula_cells.D43).toBe("=D40/'DCF Model - Base (1)'!$I$16");
          expect(workbook.summary_formula_cells.H43).toBe("=H40/'DCF Model - Base (1)'!$I$16");
          for (const cell of ['F17', 'F19', 'I13', 'I14', 'I15', 'I16', 'I17']) {
            expect(workbook.editable_cells[cell]?.is_formula, `${cell} remains a source or assumption input`).toBe(false);
            expect(workbook.editable_cells[cell]?.font_rgb?.slice(-6), `${cell} is marked as an editable input`).toBe('0000FF');
          }
        }

        if (testCase.ticker === 'CAT') {
          expect(workbook.model_title).toContain('CAT');
          expect(workbook.formula_cells.B5).toBe('=MEDIAN(G24:G28)');
          expect(workbook.formula_cells.B7).toBe('=IF(B6>0,B6,B5)');
          expect(workbook.formula_cells.B8).toBe('=B4*B7');
          expect(workbook.formula_cells.B15).toBe('=B8+B10+B11-B12-B13-B14');
          expect(workbook.formula_cells.B17).toBe('=IFERROR(B15/B16,0)');
          expect(workbook.formula_cells.B19).toBe('=IFERROR(B17/B18-1,0)');
          for (const cell of ['B6', 'I6', 'I7', 'I8']) {
            expect(workbook.editable_cells[cell]?.is_formula, cell + ' is an editable valuation input').toBe(false);
            expect(workbook.editable_cells[cell]?.font_rgb?.slice(-6), cell + ' is visibly editable').toBe('0000FF');
          }
        }

        if (testCase.ticker === 'SNOW') {
          expect(workbook.model_title).toContain('SNOW');
          expect(String(workbook.formula_cells.B5)).toMatch(/^=MEDIAN\(F24:F\d+\)$/);
          expect(workbook.formula_cells.B7).toBe('=IF(B6>0,B6,B5)');
          expect(workbook.formula_cells.B8).toBe('=B4*B7');
          expect(workbook.formula_cells.B15).toBe('=B8+B10+B11-B12-B13-B14');
          expect(workbook.formula_cells.B17).toBe('=IFERROR(B15/B16,0)');
          expect(workbook.review_notes.some((note) => note.includes('EV/Revenue valuation applies the median'))).toBe(true);
          expect(workbook.editable_cells.B6?.is_formula).toBe(false);
          expect(workbook.editable_cells.B6?.font_rgb?.slice(-6)).toBe('0000FF');
        }

        if (testCase.ticker === 'AIG') {
          for (const [cell, detail] of Object.entries(workbook.editable_cells)) {
            expect(detail.is_formula, `${cell} is an editable P&C input`).toBe(false);
            expect(detail.font_rgb?.slice(-6), `${cell} is styled as an editable P&C input`).toBe('0000FF');
          }
          expect(workbook.formula_count).toBeGreaterThan(100);
          expect(workbook.formula_cells.B57).toBe('=B54+B55*B56');
          expect(workbook.formula_cells.C65).toBe('=$B$5*(1+$B$41)');
          expect(workbook.formula_cells.C68).toBe('=MAX(0,$B$42+$B$14-$B$44)');
          expect(workbook.formula_cells.C89).toBe('=C82+C83-C84+C85-C86');
          expect(workbook.formula_cells.C95).toBe('=IF(C93<0,0,MIN(C94,C93))');
          expect(String(workbook.formula_cells.B108)).toContain('$B$29+B105+B107');
          expect(String(workbook.formula_cells.E118)).toContain('$H118');
          expect(String(workbook.formula_cells.E118)).toContain('$I118');
          expect(String(workbook.formula_cells.E118)).toContain('E$115');
          expect(workbook.review_notes.some((note) =>
            note.includes('statutory capital-to-premium test is an issuer-reported proxy')
          ), 'AIG Data Review discloses the statutory capital proxy').toBe(true);
          expect(workbook.review_notes.some((note) =>
            note.includes('FY2025 net_premiums_written')
            && /accession\s+\d{10}-\d{2}-\d{6}/.test(note)
            && /filed\s+20\d{2}-\d{2}-\d{2}/.test(note)
            && note.includes('USD')
          ), 'AIG workbook source review keeps the SEC accession, filed date, and units').toBe(true);
        }

        if (testCase.ticker === 'PLD') {
          for (const [cell, detail] of Object.entries(workbook.editable_cells)) {
            expect(detail.is_formula, `${cell} is an editable REIT input`).toBe(false);
            expect(detail.font_rgb?.slice(-6), `${cell} is styled as an editable REIT input`).toBe('0000FF');
          }
          expect(workbook.formula_count).toBeGreaterThan(100);
          expect(workbook.formula_cells.D10).toContain('SUM(D5:D9)');
          expect(workbook.formula_cells.D18).toContain('SUM(D11,D13:D17)');
          expect(workbook.formula_cells.D26).toContain('SUM(D19,D21:D25)');
          expect(workbook.formula_cells.D32).toBe('=D27-D31');
          expect(workbook.formula_cells.B60).toBe('=B57+B58*B59');
          expect(workbook.formula_cells.C69).toBe('=$D$36*(1+$B$51)*(C68/$D$35)');
          expect(workbook.formula_cells.C71).toBe('=$D$27*(1+$B$51)*(C68/$D$35)');
          expect(workbook.formula_cells.B64).toBe('=D36/(B63+D42+D43+D44-D41)');
          expect(workbook.formula_cells.B84).toContain('B81+B83');
          expect(workbook.formula_cells.B85).toContain('B84');
          expect(workbook.formula_cells.B87).toContain('B85');
          expect(String(workbook.formula_cells.E107)).toContain('$H107');
          expect(String(workbook.formula_cells.E107)).toContain('$I107');
          expect(workbook.review_notes.some((note) =>
            note.includes('Analyst AFFO')
            && note.includes('Core FFO')
            && note.includes('tenant improvements')
            && note.includes('property improvements')
          ), 'PLD Data Review identifies its analyst-defined AFFO adjustments').toBe(true);
          expect(workbook.review_notes.some((note) =>
            note.includes('FY2025')
            && note.toLowerCase().includes('nareit')
            && /accession\s+\d{10}-\d{2}-\d{6}/.test(note)
            && /filed\s+20\d{2}-\d{2}-\d{2}/.test(note)
            && note.includes('USD')
          ), 'PLD workbook source review retains its FFO filing provenance').toBe(true);
        }

        if (['AAPL', 'CRM', 'WMT'].includes(testCase.ticker)) {
          expect(workbook.sheets).toContain('DCF Model - Base (1)');
        } else {
          expect(workbook.sheets).toEqual([testCase.modelSheet, 'Data Review']);
          expect(workbook.model_title).toContain(testCase.ticker);
        }
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    }, 250_000);
  }

  it('rejects valuation workbook identifiers without a production model route', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-unimplemented-export-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });

    try {
      const client = new BackendApiClient(await backend.start());
      const result = await runValuationJob('AAPL', client);
      for (const valuationModel of ['residual_income'] as const) {
        const rejected = await client.exportDcf({...result.exportPayload, valuationModel})
          .then(() => false, () => true);
        expect(rejected, `${valuationModel} has no production workbook route`).toBe(true);
      }
      const missingComparableSource = await client.exportDcf({
        ...result.exportPayload,
        valuationModel: 'ev_ebitda',
      }).then(() => false, () => true);
      expect(missingComparableSource, 'a multiple route without live peer-source metadata is rejected').toBe(true);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('bridges live WMT enterprise value to common equity using filed claims and non-operating assets', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-wmt-equity-bridge-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });

    try {
      const client = new BackendApiClient(await backend.start());
      const payload = await client.getUnifiedCompany('WMT', 5);
      const annual = payload.canonical_financials.latest;
      if (!annual) throw new Error('WMT filed annual history is unavailable.');
      const mappedProfile = mapNativeProfile(payload.profile, payload.financials_native, payload.market);
      const mappedHistory = mapCanonicalFinancialsToHistoricals(payload.canonical_financials, payload.market, mappedProfile);
      expect(mappedHistory.nonControllingInterest?.at(-1)).toBe(annual.non_controlling_interest.value);
      const result = await runValuationJob('WMT', client);
      const valueOrFiledZero = (field: 'marketable_securities' | 'preferred_equity'): number => {
        const line = annual[field];
        if (line.source === 'not_applicable' && line.sources.every((source) => source.accession && source.filed)) return 0;
        if (typeof line.value === 'number') return line.value;
        throw new Error('WMT security claim is not sourced or explicitly not applicable.');
      };
      const expectedEquityValue = result.results.enterpriseValue
        + (annual.cash.value ?? 0)
        + valueOrFiledZero('marketable_securities')
        - (annual.debt.value ?? 0)
        - (annual.non_controlling_interest.value ?? 0)
        - valueOrFiledZero('preferred_equity');
      expect(result.results.equityValue).toBeCloseTo(expectedEquityValue, 0);
      expect(result.results.impliedSharePrice).toBeCloseTo(expectedEquityValue / result.results.shareCount, 6);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('uses the live revenue stages and linearly converges EBIT margin in the software DCF', async ({skip}) => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-crm-driver-parity-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });

    try {
      let result: Awaited<ReturnType<typeof runValuationJob>>;
      try {
        result = await runValuationJob('CRM', new BackendApiClient(await backend.start()));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('Insufficient financial data to run model; valuation withheld.')) {
          skip('CRM live inputs did not support a forecast in this run; the DCF engine failed closed.');
          return;
        }
        throw error;
      }
      if (result.status !== 'ready') {
        skip(`CRM live model is input-required in this run: ${result.missingInputs.map((input) => input.key).join(', ')}`);
        return;
      }
      const assumptions = result.exportPayload.assumptions;
      const stage1Growth = assumptions.revenueGrowthStage1;
      const stage2Growth = assumptions.revenueGrowthStage2;
      const stage1Years = assumptions.revenueGrowthStage1Years;
      const fadeYears = assumptions.revenueGrowthFadeYears;
      const startingMargin = assumptions.ebitMargin;
      const steadyStateMargin = assumptions.ebitMarginSteadyState;
      const marginFadeYears = assumptions.ebitMarginConvergenceYears;
      if ([stage1Growth, stage2Growth, stage1Years, fadeYears, startingMargin, steadyStateMargin, marginFadeYears]
        .some((value) => typeof value !== 'number')) {
        throw new Error('Live CRM operating-driver assumptions are incomplete.');
      }

      expect(result.results.isValuationSupported).toBe(true);
      expect(result.results.forecasts.length).toBeGreaterThan(0);
      expect(result.results.forecasts[0]?.revenueGrowth).toBeCloseTo(stage1Growth, 10);
      expect(result.results.forecasts[3]?.revenueGrowth).toBeCloseTo(
        stage1Growth + (stage2Growth - stage1Growth) * (1 / fadeYears), 10,
      );
      expect(result.results.forecasts[1]?.ebitMargin).toBeCloseTo(
        startingMargin + (steadyStateMargin - startingMargin) * (2 / marginFadeYears), 10,
      );
      expect(result.results.forecasts[marginFadeYears - 1]?.ebitMargin).toBeCloseTo(steadyStateMargin, 10);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('withholds an operating DCF valuation when live mapped revenue is unusable', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcf-live-dcf-empty-forecast-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });
    try {
      const client = new BackendApiClient(await backend.start());
      const payload = await client.getUnifiedCompany('CRM', 5);
      expect(payload.model_eligibility.preferred_model).toBe('unlevered_dcf');
      const profile = mapNativeProfile(payload.profile, payload.financials_native, payload.market);
      const historicals = mapCanonicalFinancialsToHistoricals(payload.canonical_financials, payload.market, profile);
      const assumptions = calculateInitialAssumptions(historicals);
      const noRevenueHistory = {...historicals, revenue: historicals.revenue.map(() => 0)};
      const result = calculateRoutedValuation(noRevenueHistory, assumptions, {}, payload.model_eligibility);

      expect(result.forecasts).toHaveLength(0);
      expect(result.isValuationSupported).toBe(false);
      expect(result.isSensitivitySupported).toBe(false);
      expect(result.enterpriseValue).toBeNull();
      expect(result.equityValue).toBe(0);
      expect(result.impliedSharePrice).toBe(0);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 180_000);

  it('initializes the live retail driver profile from three filed operating years', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-wmt-operating-profile-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });

    try {
      const client = new BackendApiClient(await backend.start());
      const payload = await client.getUnifiedCompany('WMT', 5);
      const recent = payload.canonical_financials.annual.slice(-3);
      const ratios = recent.map((annual) => {
        const revenue = annual.revenue.value;
        const ebit = annual.ebit.value;
        const capex = annual.capex.value;
        if (typeof revenue !== 'number' || revenue <= 0 || typeof ebit !== 'number' || typeof capex !== 'number') {
          throw new Error('WMT three-year operating driver inputs are incomplete.');
        }
        return {ebitMargin: ebit / revenue, capexRatio: capex / revenue};
      });
      const expectedEbitMargin = ratios.reduce((sum, item) => sum + item.ebitMargin, 0) / ratios.length;
      const expectedCapexRatio = ratios.reduce((sum, item) => sum + item.capexRatio, 0) / ratios.length;
      const result = await runValuationJob('WMT', client);
      expect(result.exportPayload.assumptions.ebitMargin).toBeCloseTo(expectedEbitMargin, 6);
      expect(result.exportPayload.assumptions.capexRatio).toBeCloseTo(expectedCapexRatio, 6);
      expect(result.exportPayload.assumptions.advancedMode).toBe(true);
      expect(result.exportPayload.uiMeta.sourceNotes?.some((note) =>
        note.includes('Consumer retail five-year profile')
        && note.includes('three-year filed average')
      )).toBe(true);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('uses live EV/EBITDA peers for CAT when the filed debt-cost input is unavailable', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-cat-multiple-route-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });

    try {
      const payload = await new BackendApiClient(await backend.start()).getUnifiedCompany('CAT', 5);
      expect(payload.model_eligibility.required_input_readiness?.source_supported_cost_of_debt)
        .toBe(false);
      expect(payload.model_eligibility.required_input_readiness?.ev_ebitda_route)
        .toBe(true);
      expect(payload.model_eligibility.preferred_model).toBe('ev_ebitda');
      expect(payload.model_eligibility.allowed_models).toEqual(['ev_ebitda']);
      expect(payload.model_eligibility.supported_by_current_engine).toBe(true);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('returns a bridge-blocked shell when fallback peers exist but bridge facts are missing', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-peer-fallback-block-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });

    try {
      const client = new BackendApiClient(await backend.start());
      // LLY's debt, investments, and NCI are not mapped from its filings, so
      // the equity bridge stays fail-closed. Its peers are sector-table
      // fallbacks (#60): staged for review only with analyst confirmations,
      // which cannot exist while the bridge is missing — so comps stays empty
      // and the workbook names the bridge gap instead of unconfirmed rows.
      const payload = await client.getUnifiedCompany('LLY', 5);
      expect(payload.model_eligibility.required_input_readiness?.multiple_source_ready_equity_bridge).toBe(false);
      // LLY peers are sector-table fallbacks (#60): staged for review but
      // never the ready median, so the multiple-peers readiness stays false.
      expect(payload.model_eligibility.required_input_readiness?.multiple_three_current_ev_ebitda_peers).toBe(false);
      expect(payload.model_eligibility.supported_by_current_engine).toBe(false);
      expect(payload.model_eligibility.status).toBe('input_required');
      expect(payload.model_eligibility.model_route_available).toBe(true);
      expect(payload.model_eligibility.allowed_models).toEqual([payload.model_eligibility.preferred_model]);

      const result = await runValuationJob('LLY', client);
      expect(result.status, 'LLY bridge gap shells cleanly').toBe('input_required');
      expect(result.results, 'LLY skips valuation').toBeNull();
      const keys = result.exportPayload.requiredInputs.map((input) => input.key);
      // The workbook mapper cannot stage peer confirmation rows without the
      // equity bridge, so no peer confirmation rows may appear: the honest
      // sheet names the bridge gap while keeping filing-derived peer comps.
      expect(keys.some((key) => key.startsWith('peer_')), 'no dangling peer rows').toBe(false);
      expect(keys, 'bridge gap surfaced').toContain('multiple_source_ready_equity_bridge');
      // Fallback peers stay out of comps without analyst confirmations (#60);
      // the bridge gap names the blocker instead of staging unconfirmed rows.
      expect(result.exportPayload.comps.length, 'no unconfirmed fallback peers in comps').toEqual(0);
      expect(result.workbookBytes.byteLength).toBeGreaterThan(1_000);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('builds an incomplete MU peer schedule from fallback peers without operating-model inputs', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-mu-fallback-peers-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });

    try {
      const client = new BackendApiClient(await backend.start());
      const result = await runValuationJob('MU', client);
      expect(result.status, 'MU fallback peers produce an incomplete schedule').toBe('input_required');
      expect(result.results, 'MU skips valuation').toBeNull();
      const keys = result.exportPayload.requiredInputs.map((input) => input.key);
      // Multiple math never needs operating-model inputs: no tax, working
      // capital, or driver-history requirements may leak into the sheet.
      expect(keys.some((key) => key === 'source_supported_tax_rate'
        || key === 'working_capital_accounts_payable'
        || key === 'three_year_operating_driver_history'), 'no operating-key leak').toBe(false);
      const confirmations = keys.filter((key) => key.startsWith('peer_ebitda:'));
      expect(confirmations.length, 'fallback peers need analyst confirmation').toBeGreaterThanOrEqual(3);
      expect(result.exportPayload.comparableModel?.peerFallbackUsed, 'fallback schedule built').toBe(true);
      expect(result.workbookBytes.byteLength).toBeGreaterThan(10_000);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('exports incomplete CAT EV/EBITDA and SNOW EV/Revenue models for a missing current peer denominator', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-incomplete-comps-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {...process.env, HOME: home, DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite')},
    });

    try {
      const client = new BackendApiClient(await backend.start());
      for (const testCase of [
        {ticker: 'CAT', model: 'ev_ebitda' as const, metric: 'ebitda' as const, gap: 'multiple_three_current_ev_ebitda_peers'},
        {ticker: 'SNOW', model: 'revenue_multiple' as const, metric: 'revenue' as const, gap: 'multiple_three_current_ev_revenue_peers'},
      ]) {
        const completeData = await client.getUnifiedCompany(testCase.ticker, 5);
        const completeResult = await runValuationJob(testCase.ticker, client);
        expect(completeResult.status, `${testCase.ticker} complete comparator route`).toBe('ready');
        const completeWorkbookPath = join(home, `${testCase.ticker.toLowerCase()}_complete.xlsx`);
        await writeFile(completeWorkbookPath, completeResult.workbookBytes);
        const incomplete = structuredClone(completeData);
        const peerIndex = incomplete.peers.findIndex((rawPeer) => {
          const peer = rawPeer as unknown as Record<string, unknown>;
          const amount = peer[testCase.metric];
          const enterpriseValue = peer.enterprise_value ?? peer.enterpriseValue;
          const peerTicker = peer.ticker ?? peer.symbol;
          return typeof peerTicker === 'string' && typeof enterpriseValue === 'number'
            && enterpriseValue > 0 && typeof amount === 'number' && amount > 0;
        });
        if (peerIndex < 0) throw new Error(`Live ${testCase.ticker} peer set has no sourced denominator to redact.`);
        const peer = incomplete.peers[peerIndex] as unknown as Record<string, unknown>;
        const peerTicker = String(peer.ticker ?? peer.symbol).toUpperCase();
        const restoredDenominator = Number(peer[testCase.metric]);
        incomplete.peers[peerIndex] = {...peer, [testCase.metric]: null};
        incomplete.model_eligibility.status = 'input_required';
        incomplete.model_eligibility.model_route_available = true;
        incomplete.model_eligibility.supported_by_current_engine = false;
        incomplete.model_eligibility.preferred_model = testCase.model;
        incomplete.model_eligibility.allowed_models = [testCase.model];
        incomplete.model_eligibility.required_input_readiness = {
          ...incomplete.model_eligibility.required_input_readiness,
          [testCase.gap]: false,
        };
        incomplete.model_eligibility.missing_input_gaps = [{
          key: testCase.gap,
          label: `Three current source-ready ${testCase.model === 'ev_ebitda' ? 'EV/EBITDA' : 'EV/Revenue'} peers`,
          reason: `One current ${testCase.model === 'ev_ebitda' ? 'EBITDA' : 'revenue'} denominator is missing from the qualified peer set.`,
        }];

        const result = await runValuationJob(testCase.ticker, {
          getUnifiedCompany: async () => incomplete,
          exportDcf: (payload: Parameters<typeof client.exportDcf>[0]) => client.exportDcf(payload),
        });
        expect(result.status, `${testCase.ticker} status`).toBe('input_required');
        expect(result.results, `${testCase.ticker} skips valuation`).toBeNull();
        expect(result.missingInputs.some((input) => input.key === `peer_${testCase.metric}:${peerTicker}`
          && input.inputType === 'market_data' && input.unit === 'USD actual' && input.sourceReferenceRequired),
        `${testCase.ticker} peer diagnostics: ${JSON.stringify({
          inputs: result.missingInputs,
          peerQuality: completeData.data_quality.peers,
          selectedPeer: incomplete.peers[peerIndex],
        })}`).toBe(true);
        expect(result.exportPayload).toHaveProperty('comparableModel');
        expect(result.exportPayload.comps?.some((item) => item.ticker === peerTicker
          && item[testCase.metric === 'ebitda' ? 'ebitda' : 'revenue'] === 0),
        `${testCase.ticker} keeps the peer row but does not fill its missing denominator`).toBe(true);
        expect(restoredDenominator).toBeGreaterThan(0);

        const incompleteWorkbookPath = join(home, `${testCase.ticker.toLowerCase()}_incomplete.xlsx`);
        const restoredSource = 'Test fixture: original live peer record';
        await writeFile(incompleteWorkbookPath, result.workbookBytes);
        const workbook = await inspectIncompleteComparableWorkbook(
          incompleteWorkbookPath,
          testCase.metric,
          peerTicker,
          restoredDenominator,
          restoredSource,
          completeWorkbookPath,
        );
        expect(workbook.sheets).toEqual(['Comparable Valuation', 'Input Required', 'Data Review']);
        expect(workbook.formula_errors, `${testCase.ticker} formula errors`).toEqual([]);
        expect(workbook.formula_count).toBeGreaterThan(20);
        expect(workbook.input_value).toBeNull();
        expect(workbook.input_font_rgb?.slice(-6)).toBe('0000FF');
        expect(workbook.input_locked).toBe(false);
        expect(workbook.source_required).toBe('Yes');
        expect(workbook.status_value).toBe('INCOMPLETE — fill required inputs');
        expect(String(workbook.missing_denominator_formula)).toContain("'Input Required'");
        expect(workbook.missing_denominator_value).toBeNull();
        expect(String(workbook.missing_multiple_formula)).toContain('READY');
        expect(workbook.missing_multiple_value).toBeNull();
        expect(Object.values(workbook.guarded_formulas).every((formula) => typeof formula === 'string'
          && formula.startsWith('=IF'))).toBe(true);
        expect(Object.values(workbook.guarded_values).every((value) => value === null || value === '')).toBe(true);
        expect(workbook.restored_status).toBe('READY');
        expect(workbook.restored_source_reference).toBe(restoredSource);
        expect(workbook.restored_review_status).toBe('READY');
        expect(typeof workbook.restored_peer_denominator).toBe('number');
        expect(typeof workbook.restored_peer_multiple).toBe('number');
        expect(workbook.invalid_status).toBe('INPUT ERROR — check required inputs');
        expect(Object.values(workbook.invalid_values).every((value) => value === null || value === '')).toBe(true);
        for (const cell of ['B5', 'B7', 'B8', 'B15', 'B17', 'B19']) {
          const restoredValue = workbook.restored_values[cell];
          const completeValue = workbook.complete_values[cell];
          expect(typeof restoredValue, `${testCase.ticker} restored ${cell}`).toBe('number');
          expect(typeof completeValue, `${testCase.ticker} complete ${cell}`).toBe('number');
          const difference = Math.abs(Number(restoredValue) - Number(completeValue));
          expect(difference, `${testCase.ticker} restored ${cell} matches complete`).toBeLessThanOrEqual(
            Math.max(0.01, Math.abs(Number(completeValue)) * 1e-8),
          );
        }
        expect(workbook.edited_formula).toBe('=B4*B7*1.01');
        expect(workbook.edited_values.B4).toBe(workbook.complete_values.B4);
        expect(Number(workbook.edited_values.B8)).toBeCloseTo(Number(workbook.complete_values.B8) * 1.01, 2);
        expect(Number(workbook.edited_values.B17)).toBeGreaterThan(Number(workbook.complete_values.B17));
      }
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  for (const testCase of draftSectorCases) {
    it(`routes draft sector ${testCase.ticker} to its filing-derived incomplete workbook`, async () => {
      assertEdgarIdentityConfigured();
      const home = await mkdtemp(join(tmpdir(), `dcfbuild-live-blocked-${testCase.ticker.toLowerCase()}-`));
      const outputPath = join(home, `${testCase.ticker.toLowerCase()}_dcf.xlsx`);

      try {
        const result = runLiveCli(testCase.ticker, outputPath, home);
        if (result.error) throw new Error(`Live dcfbuild failed (${result.error.name}).`);
        const output = sanitizedOutput(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
        expect(result.status, output).toBe(0);
        expect(output).toContain(testCase.blockReason);
        expect(output).toContain(`Workbook: ${outputPath}`);
        const workbookBytes = await readFile(outputPath);
        expect([...workbookBytes.subarray(0, 2)]).toEqual([0x50, 0x4b]);
      } finally {
        await rm(home, {recursive: true, force: true});
      }
    }, 250_000);
  }

  it('exports a live incomplete telecom workbook when required subscriber data is absent', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-input-required-vz-'));
    const outputPath = join(home, 'vz_dcf.xlsx');

    try {
      const result = runLiveCli('VZ', outputPath, home);
      if (result.error) throw new Error(`Live dcfbuild failed (${result.error.name}).`);
      const output = sanitizedOutput(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
      expect(result.status, output).toBe(0);
      expect(output).toContain(`Workbook: ${outputPath}`);
      expect(output).toContain('Status: INCOMPLETE — no valuation was calculated.');
      expect(output).toContain('Three Year Wireless Subscribers');
      expect(output).toContain('Required inputs:');
      expect(output).not.toMatch(/implied price|upside/i);
      const workbookBytes = await readFile(outputPath);
      expect([...workbookBytes.subarray(0, 2)]).toEqual([0x50, 0x4b]);
    } finally {
      await rm(home, {recursive: true, force: true});
    }
  }, 250_000);

  it('classifies live core operating issuers and exposes only the implemented valuation route', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-operating-archetypes-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });

      const expectedArchetypes = [
        {ticker: 'AAPL', archetype: 'technology_hardware', model: 'unlevered_dcf'},
        {ticker: 'CRM', archetype: 'subscription_software', model: 'unlevered_dcf'},
        {ticker: 'WMT', archetype: 'consumer_retail', model: 'unlevered_dcf'},
        {ticker: 'CAT', archetype: 'industrial_manufacturing', model: 'ev_ebitda'},
        {ticker: 'NVDA', archetype: 'semiconductor', model: 'ev_ebitda'},
        {ticker: 'SNOW', archetype: 'subscription_software', model: 'revenue_multiple'},
        {ticker: 'T', archetype: 'telecommunications', model: 'telecom_subscriber_dcf'},
      ];
      const fallbackArchetypes = [
        {ticker: 'CVX', archetype: 'energy_materials', model: 'ev_ebitda' as const, reason: 'production, reserve'},
      ];
      const inputRequiredArchetypes = [
        {ticker: 'VZ', archetype: 'telecommunications', model: 'telecom_subscriber_dcf', missingField: 'wireless_subscribers'},
      ];

    try {
      const client = new BackendApiClient(await backend.start());
      for (const {ticker, archetype, model} of expectedArchetypes) {
        const payload = await client.getUnifiedCompany(ticker, 5);
        const eligibility = payload.model_eligibility as unknown as Record<string, unknown>;
        expect(eligibility.operating_archetype, `${ticker} operating archetype`).toBe(archetype);
        expect(payload.model_eligibility.preferred_model, `${ticker} preferred model`).toBe(model);
        const readiness = payload.model_eligibility.required_input_readiness ?? {};
        if (ticker === 'T') {
          const usdCurrency = payload.canonical_financials.currency?.toUpperCase() === 'USD';
          expect(readiness.usd_reporting_currency, `${ticker} route has explicit USD source readiness`).toBe(usdCurrency);
          if (!usdCurrency) {
            expect(payload.model_eligibility.status).toBe('unsupported');
            expect(payload.model_eligibility.model_route_available).toBe(false);
            expect(payload.model_eligibility.allowed_models).toEqual([]);
            continue;
          }
        }
        expect(Object.keys(readiness).length, `${ticker} reports required-input readiness`).toBeGreaterThan(0);
        expect(Object.values(readiness).every((value) => typeof value === 'boolean'), `${ticker} readiness values are explicit`).toBe(true);
        const latestCanonical = payload.canonical_financials.latest;
        const debtLine = ticker === 'T'
          ? (latestCanonical.telecom?.interest_bearing_debt ?? latestCanonical.debt)
          : latestCanonical.debt;
        expect(debtLine?.value, `${ticker} filed debt balance is reconciled`).toEqual(expect.any(Number));
        expect(debtLine?.value, `${ticker} filed debt balance is non-negative`).toBeGreaterThanOrEqual(0);
        expect(debtLine?.sources.length, `${ticker} debt has source lineage`).toBeGreaterThan(0);
        expect(debtLine?.sources.every((source) => source.accession && source.filed), `${ticker} debt source lineage is filed`).toBe(true);
        const securities = latestCanonical.marketable_securities;
        if (securities.source === 'not_applicable') {
          expect(securities.sources.length, `${ticker} securities disposition has filing provenance`).toBeGreaterThan(0);
          expect(securities.sources.every((source) => source.accession && source.filed), `${ticker} securities provenance is filed`).toBe(true);
        } else if (securities.source === 'missing' || securities.source === 'ambiguous') {
          expect(payload.model_eligibility.required_input_readiness?.equity_bridge_marketable_securities,
            `${ticker} missing or ambiguous securities block the bridge`).toBe(false);
        } else {
          expect(['sec_native', 'derived'].includes(securities.source), `${ticker} securities have a source-backed value`).toBe(true);
          expect(securities.sources.every((source) => source.accession && source.filed), `${ticker} securities provenance is filed`).toBe(true);
        }
        const multipleOnlyFields = new Set([
          'multiple_positive_filed_ebitda', 'multiple_positive_filed_revenue',
          'multiple_source_ready_equity_bridge', 'multiple_live_price_and_filed_shares',
          'multiple_three_current_ev_ebitda_peers', 'multiple_three_current_ev_revenue_peers',
          'ev_ebitda_route', 'revenue_multiple_route',
        ]);
        const dcfInputsReady = Object.entries(readiness)
          .filter(([field]) => !multipleOnlyFields.has(field))
          .every(([, value]) => value === true);
        const preferredRouteReady = model === 'unlevered_dcf' ? dcfInputsReady : readiness[`${model}_route`] === true;
        expect(payload.model_eligibility.supported_by_current_engine, `${ticker} support matches selected-route readiness`)
          .toBe(preferredRouteReady);
        const allowedModels = payload.model_eligibility.allowed_models;
        expect(allowedModels, `${ticker} allowed routes`).toEqual(
          payload.model_eligibility.model_route_available ? [model] : [],
        );
        expect(payload.model_eligibility.model_route_available, `${ticker} has a production route`).toBe(true);
        if (ticker === 'CAT') {
          expect(readiness.source_supported_cost_of_debt, 'CAT remains blocked from DCF without a filed debt cost').toBe(false);
          expect(readiness.ev_ebitda_route, 'CAT has a source-ready trading multiple route').toBe(true);
        }
        if (ticker === 'AAPL') {
          expect(readiness.ev_ebitda_route, 'AAPL has a source-ready trading multiple route').toBe(true);
          expect(payload.model_eligibility.supported_by_current_engine).toBe(true);
          expect(payload.model_eligibility.status).toBe('ready');
          expect(payload.model_eligibility.allowed_models).toEqual(['unlevered_dcf']);
        }
        if (ticker === 'NVDA') {
          expect(readiness.filed_capex, 'NVDA has filed or derived CapEx for the operating engine').toBe(true);
          expect(readiness.multiple_source_ready_equity_bridge, 'NVDA bridge is source-ready').toBe(true);
          expect(readiness.ev_ebitda_route, 'NVDA has a source-ready trading multiple route').toBe(true);
          expect(payload.model_eligibility.supported_by_current_engine).toBe(true);
          expect(payload.model_eligibility.status).toBe('ready');
          expect(payload.model_eligibility.allowed_models).toEqual(['ev_ebitda']);
        }
        if (ticker === 'SNOW') {
          expect(payload.model_eligibility.preferred_model).toBe('revenue_multiple');
          expect(readiness.revenue_multiple_route).toBe(true);
        }
        if (ticker === 'T') {
          expect(payload.model_eligibility.preferred_model).toBe('telecom_subscriber_dcf');
          if (readiness.telecom_subscriber_dcf_route) {
            expect(readiness.three_year_postpaid_phone_churn).toBe(true);
            expect(readiness.three_year_network_capex).toBe(true);
          } else {
            expect(payload.model_eligibility.status).toBe('input_required');
            expect(payload.model_eligibility.supported_by_current_engine).toBe(false);
          }
        }
      }
      for (const {ticker, archetype, model: fallbackModel, reason} of fallbackArchetypes) {
        const payload = await client.getUnifiedCompany(ticker, 5);
        const eligibility = payload.model_eligibility as unknown as Record<string, unknown>;
        expect(eligibility.operating_archetype, `${ticker} operating archetype`).toBe(archetype);
        expect(eligibility.status, `${ticker} multiple route is source-ready`).toBe('ready');
        expect(eligibility.model_route_available, `${ticker} model route availability`).toBe(true);
        expect(payload.model_eligibility.supported_by_current_engine, `${ticker} ev_ebitda route calculates`).toBe(true);
        expect(payload.model_eligibility.preferred_model, `${ticker} preferred model`).toBe(fallbackModel);
        expect(payload.model_eligibility.allowed_models, `${ticker} permits the multiple fallback`).toEqual([fallbackModel]);
        expect(payload.model_eligibility.blocked_models.some((item) => item.reason.includes(reason)),
          `${ticker} names the unavailable specialist model`).toBe(true);
      }

      for (const {ticker, archetype, model, missingField} of inputRequiredArchetypes) {
        const payload = await client.getUnifiedCompany(ticker, 5);
        const eligibility = payload.model_eligibility as unknown as Record<string, unknown>;
        expect(eligibility.operating_archetype, `${ticker} operating archetype`).toBe(archetype);
        expect(eligibility.status, `${ticker} build status`).toBe('input_required');
        expect(eligibility.model_route_available, `${ticker} has an implemented model family`).toBe(true);
        expect(eligibility.supported_by_current_engine, `${ticker} is not ready to calculate a valuation`).toBe(false);
        expect(eligibility.allowed_models, `${ticker} exposes its implemented route`).toEqual([model]);
        const gaps = eligibility.missing_input_gaps as Array<Record<string, unknown>>;
        const subscriberGap = gaps.find((gap) => gap.key === `three_year_${missingField}`);
        expect(typeof subscriberGap?.label, `${ticker} labels the missing subscriber readiness gap`).toBe('string');
        expect(subscriberGap?.reason, `${ticker} explains which readiness check failed`)
          .toContain(`three_year_${missingField}`);
      }

      const liveNeeClassify = await client.getUnifiedCompany('NEE', 5);
      const neeClassifyEligibility = liveNeeClassify.model_eligibility as unknown as Record<string, unknown>;
      // Filing-derived classification now resolves NEE off its 10-K text: the
      // regulated utility family is implemented but source-incomplete.
      expect(neeClassifyEligibility.subtype, 'NEE classifies off filed 10-K text').toBe('regulated_utility');
      expect(neeClassifyEligibility.status, 'NEE has an implemented but source-incomplete utility family').toBe('input_required');
      expect(neeClassifyEligibility.model_route_available, 'NEE exposes the utility model input workbook').toBe(true);
      expect(neeClassifyEligibility.allowed_models).toEqual(['utility_dcf']);

      const liveDuk = await client.getUnifiedCompany('DUK', 5);
      const dukEligibility = liveDuk.model_eligibility as unknown as Record<string, unknown>;
      expect(dukEligibility.status, 'DUK has an implemented but source-incomplete utility family').toBe('input_required');
      expect(dukEligibility.model_route_available, 'DUK exposes the utility model input workbook').toBe(true);
      expect(dukEligibility.allowed_models).toEqual(['utility_dcf']);

      const xom = await client.getUnifiedCompany('XOM', 5);
      expect(xom.model_eligibility.operating_archetype).toBe('energy_materials');
      // Filing-shape routing resolves XOM to the ready specialist energy model:
      // its 10-K production schedules parse completely (246 filed facts).
      expect(xom.model_eligibility.preferred_model).toBe('integrated_energy_dcf');
      expect(xom.model_eligibility.status).toBe('ready');
      expect(xom.model_eligibility.supported_by_current_engine).toBe(true);
      expect(xom.model_eligibility.allowed_models).toEqual(['integrated_energy_dcf']);

      const agnc = await client.getUnifiedCompany('AGNC', 5);
      const mortgageReadiness = agnc.model_eligibility.required_input_readiness ?? {};
      expect(agnc.model_eligibility.subtype).toBe('mortgage_reit');
      expect(agnc.model_eligibility.preferred_model).toBe('mortgage_reit_residual_income');
      // Live filings source-ready the specialist mortgage inputs (149 filed
      // facts), so the route is ready.
      expect(agnc.model_eligibility.status).toBe('ready');
      expect(mortgageReadiness.mortgage_reit_residual_income_route).toBe(true);
      expect(agnc.model_eligibility.supported_by_current_engine).toBe(true);
      expect(agnc.model_eligibility.allowed_models).toEqual(['mortgage_reit_residual_income']);

      const liveAapl = await client.getUnifiedCompany('AAPL', 5);
      const aaplEligibility = liveAapl.model_eligibility as unknown as Record<string, unknown>;
      expect(aaplEligibility.status, 'AAPL has a complete model and source set').toBe('ready');
      expect(aaplEligibility.model_route_available, 'AAPL has a production model family').toBe(true);
      expect(aaplEligibility.missing_input_gaps, 'AAPL has no missing required model inputs').toEqual([]);
      expect(() => parseModelEligibility({
        ...liveAapl.model_eligibility,
        supported_by_current_engine: true,
        preferred_model: 'residual_income',
        allowed_models: ['residual_income'],
      }), 'a payload cannot claim an unimplemented model is supported').toThrow();
      expect(() => parseModelEligibility({
        ...liveAapl.model_eligibility,
        status: 'input_required',
        supported_by_current_engine: false,
        model_route_available: true,
        missing_input_gaps: [{key: 'three_year_wireless_subscribers', reason: 'Missing three-year series.'}],
      }), 'a readiness gap missing its display label is rejected').toThrow();
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('calculates a live subscriber, churn, broadband, and segment telecom DCF', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-telecom-engine-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {...process.env, HOME: home, DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite')},
    });
    try {
      const payload = await new BackendApiClient(await backend.start()).getUnifiedCompany('T', 5);
      if (!payload.model_eligibility.supported_by_current_engine) {
        const usdCurrency = payload.canonical_financials.currency?.toUpperCase() === 'USD';
        expect(payload.model_eligibility.status).toBe(usdCurrency ? 'input_required' : 'unsupported');
        expect(payload.model_eligibility.model_route_available).toBe(usdCurrency);
        expect(payload.model_eligibility.missing_input_gaps.length).toBeGreaterThan(0);
        return;
      }
      const historical = mapCanonicalTelecomFinancialsToHistoricals(payload.canonical_financials);
      const {buildSourcedTelecomModelAssumptions} = await import('@/services/valuation/telecom-assumption-policy');
      const {calculateTelecomValuation} = await import('@/services/valuation/telecom-model');
      const assumptions = buildSourcedTelecomModelAssumptions(payload, historical);
      const results = calculateTelecomValuation(historical, assumptions);

      expect(historical.years).toEqual([2022, 2023, 2024, 2025]);
      expect(results.telecomForecasts).toHaveLength(5);
      for (const forecast of results.telecomForecasts) {
        expect(forecast.totalRevenue).toBeCloseTo(
          forecast.mobilityServiceRevenue + forecast.mobilityEquipmentRevenue + forecast.businessWirelineRevenue
            + forecast.consumerWirelineRevenue + forecast.latinAmericaRevenue + forecast.otherRevenue,
          2,
        );
        expect(forecast.freeCashFlow).toBeCloseTo(
          forecast.ebit * (1 - forecast.taxRate) + forecast.depreciation - forecast.capex - forecast.workingCapitalChange,
          2,
        );
        expect(forecast.endingWirelessSubscribers).toBeGreaterThan(0);
        expect(forecast.endingBroadbandConnections).toBeGreaterThan(0);
      }
      expect(results.enterpriseValue).toBeGreaterThan(0);
      expect(results.equityValue).toBeGreaterThan(0);
      expect(results.impliedSharePrice).toBeGreaterThan(0);
      expect(calculateTelecomValuation(historical, {...assumptions, postpaidGrossAddRate: assumptions.postpaidGrossAddRate + 0.01}).equityValue)
        .toBeGreaterThan(results.equityValue);
      expect(calculateTelecomValuation(historical, {...assumptions, postpaidPhoneMonthlyChurn: assumptions.postpaidPhoneMonthlyChurn + 0.001}).equityValue)
        .toBeLessThan(results.equityValue);
      expect(calculateTelecomValuation(historical, {...assumptions, serviceRevenuePerSubscriberGrowth: assumptions.serviceRevenuePerSubscriberGrowth + 0.01}).equityValue)
        .toBeGreaterThan(results.equityValue);
      expect(calculateTelecomValuation(historical, {...assumptions, capexPctRevenue: assumptions.capexPctRevenue + 0.01}).equityValue)
        .toBeLessThan(results.equityValue);
      expect(calculateTelecomValuation(historical, {...assumptions, wacc: assumptions.wacc + 0.005}).equityValue)
        .toBeLessThan(results.equityValue);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('exports and recalculates a live AT&T telecom workbook with editable driver formulas', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-telecom-workbook-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {...process.env, HOME: home, DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite')},
    });
    try {
      const client = new BackendApiClient(await backend.start());
      const data = await client.getUnifiedCompany('T', 5);
      if (!data.model_eligibility.supported_by_current_engine) {
        const usdCurrency = data.canonical_financials.currency?.toUpperCase() === 'USD';
        expect(data.model_eligibility.status).toBe(usdCurrency ? 'input_required' : 'unsupported');
        expect(data.model_eligibility.model_route_available).toBe(usdCurrency);
        return;
      }
      const history = mapCanonicalTelecomFinancialsToHistoricals(data.canonical_financials);
      const {buildSourcedTelecomModelAssumptions} = await import('@/services/valuation/telecom-assumption-policy');
      const {calculateTelecomValuation} = await import('@/services/valuation/telecom-model');
      const {buildTelecomModelExportPayload} = await import('@/services/exporters/excel/telecom-payload');
      const profile = mapNativeProfile(data.profile, data.financials_native, data.market);
      const assumptions = buildSourcedTelecomModelAssumptions(data, history);
      const engineResults = calculateTelecomValuation(history, assumptions);
      const payload = buildTelecomModelExportPayload(profile, history, assumptions);
      expect(payload.valuationModel).toBe('telecom_subscriber_dcf');
      expect(() => parseDcfExportPayload(payload)).not.toThrow();

      const pythonScript = `import json, subprocess, sys
from pathlib import Path
from openpyxl import Workbook, load_workbook
from app.api.contracts import TelecomModelExportData
from app.services.excel_export.mappers.telecom_model import apply_telecom_model

with open(sys.argv[1], encoding='utf-8') as source:
    payload = json.load(source)
TelecomModelExportData.model_validate(payload['telecomModel'])
workbook_path = Path(sys.argv[2])
workbook = Workbook()
apply_telecom_model(workbook, payload)
workbook.save(workbook_path)

variant_specs = {
    'gross_adds': ('L5', lambda value: value + 0.01),
    'higher_churn': ('L6', lambda value: value + 0.001),
    'service_growth': ('L8', lambda value: value + 0.01),
    'network_capex': ('L23', lambda value: value + 0.01),
    'higher_wacc': ('L25', lambda value: value + 0.01),
    'terminal_growth': ('L30', lambda value: value + 0.005),
    'diluted_shares': ('L32', lambda value: value * 1.01),
}
source_paths = {'base': workbook_path}
for name, (cell, edit) in variant_specs.items():
    variant = load_workbook(workbook_path, data_only=False)
    sheet = variant['Telecom Model']
    sheet[cell] = edit(float(sheet[cell].value))
    variant_path = workbook_path.with_name(f'{workbook_path.stem}-{name}.xlsx')
    variant.save(variant_path)
    source_paths[name] = variant_path

debt_variant = load_workbook(workbook_path, data_only=False)
debt_sheet = debt_variant['Telecom Model']
debt_sheet['L36'] = float(debt_sheet['L36'].value) + 100000000
debt_sheet['L40'] = float(payload['telecomModel']['assumptions']['wacc'])
debt_path = workbook_path.with_name(f'{workbook_path.stem}-higher-debt.xlsx')
debt_variant.save(debt_path)
source_paths['higher_debt'] = debt_path

restore_book = load_workbook(workbook_path, data_only=False)
restore_sheet = restore_book['Telecom Model']
original_adds = float(restore_sheet['L5'].value)
restore_sheet['L5'] = original_adds + 0.01
restore_sheet['L5'] = original_adds
restore_path = workbook_path.with_name(f'{workbook_path.stem}-restored.xlsx')
restore_book.save(restore_path)
source_paths['restored'] = restore_path

recalc_dir = workbook_path.parent / 'recalculated'
profile_dir = workbook_path.parent / 'libreoffice-profile'
recalc_dir.mkdir(parents=True, exist_ok=True)
profile_dir.mkdir(parents=True, exist_ok=True)
process = subprocess.run([
    sys.argv[3], '--headless', f'-env:UserInstallation={profile_dir.as_uri()}', '--convert-to', 'xlsx',
    '--outdir', str(recalc_dir), *[str(path) for path in source_paths.values()],
], capture_output=True, text=True, timeout=120)
if process.returncode != 0:
    raise RuntimeError(process.stderr or process.stdout or 'LibreOffice failed to recalculate telecom workbooks.')

def output_for(name):
    cached = load_workbook(recalc_dir / source_paths[name].name, data_only=True)
    sheet = cached['Telecom Model']
    errors = [cell.coordinate for row in sheet.iter_rows() for cell in row
              if isinstance(cell.value, str) and cell.value.startswith('#')]
    return {
        'enterprise_value': sheet['B77'].value,
        'equity_value': sheet['B83'].value,
        'per_share': sheet['B85'].value,
        'wacc': sheet['L40'].value,
        'sensitivity': [[sheet[f'{column}{row}'].value for column in 'CDEFG'] for row in range(91, 96)],
        'customer_checks': [sheet[f'{column}18'].value for column in 'FGHIJ'],
        'revenue_checks': [sheet[f'{column}42'].value for column in 'FGHIJ'],
        'ebit_checks': [sheet[f'{column}56'].value for column in 'FGHIJ'],
        'fcff_checks': [sheet[f'{column}68'].value for column in 'FGHIJ'],
        'formula_errors': errors,
    }

inspection_book = load_workbook(workbook_path, data_only=False)
sheet = inspection_book['Telecom Model']
review = inspection_book['Data Review']
formula_cells = {cell.coordinate: cell.value for row in sheet.iter_rows() for cell in row
                 if isinstance(cell.value, str) and cell.value.startswith('=')}
review_text = ' '.join(str(cell.value) for row in review.iter_rows() for cell in row if cell.value is not None)
print(json.dumps({
    'sheets': inspection_book.sheetnames,
    'wireless_ending': sheet['F10'].value,
    'service_revenue': sheet['F22'].value,
    'broadband_revenue': sheet['F35'].value,
    'total_revenue': sheet['F41'].value,
    'fcff': sheet['F65'].value,
    'enterprise_value': sheet['B77'].value,
    'equity_value': sheet['B83'].value,
      'per_share': sheet['B85'].value,
    'wacc': sheet['L40'].value,
    'input_color': sheet['L5'].font.color.rgb if sheet['L5'].font.color else None,
    'percent_format': sheet['L6'].number_format,
    'formula_cells': formula_cells,
    'has_sec_accession': '0000732717-26-000120' in review_text,
    'has_ref_error': any('#REF!' in str(formula) for formula in formula_cells.values()),
    'recalculated': {name: output_for(name) for name in source_paths},
}))`;
      const inputPath = join(home, 't-telecom-export.json');
      const workbookPath = join(home, 't-telecom-live.xlsx');
      await writeFile(inputPath, JSON.stringify(payload), 'utf8');
      const inspected = spawnSync(pythonPath, ['-c', pythonScript, inputPath, workbookPath,
        sofficePath], {
        cwd: resolve(projectRoot, 'backend'), encoding: 'utf8', maxBuffer: 3 * 1024 * 1024, timeout: 180_000,
      });
      if (inspected.error) throw inspected.error;
      if (inspected.status !== 0) throw new Error(`AT&T telecom workbook inspection failed: ${inspected.stderr}`);
      const inspection = JSON.parse(inspected.stdout.trim().split(/\r?\n/).at(-1) ?? '{}') as {
        sheets: string[];
        wireless_ending: unknown;
        service_revenue: unknown;
        broadband_revenue: unknown;
        total_revenue: unknown;
        fcff: unknown;
        enterprise_value: unknown;
        equity_value: unknown;
        per_share: unknown;
        input_color: string | null;
        percent_format: string;
        formula_cells: Record<string, string>;
        has_sec_accession: boolean;
        has_ref_error: boolean;
        recalculated: Record<string, {
          enterprise_value: number;
          equity_value: number;
          per_share: number;
          wacc: number;
          sensitivity: Array<Array<number | null>>;
          customer_checks: Array<number | null>;
          revenue_checks: Array<number | null>;
          ebit_checks: Array<number | null>;
          fcff_checks: Array<number | null>;
          formula_errors: string[];
        }>;
      };
      expect(inspection.sheets).toEqual(['Telecom Model', 'Data Review']);
      for (const [cell, value] of Object.entries({F10: inspection.wireless_ending, F22: inspection.service_revenue, F35: inspection.broadband_revenue,
        F41: inspection.total_revenue, F65: inspection.fcff, B77: inspection.enterprise_value, B83: inspection.equity_value, B85: inspection.per_share})) {
        expect(String(value), `${cell} is formula-driven`).toMatch(/^=/);
      }
      expect(inspection.input_color).toMatch(/0000FF$/);
      expect(inspection.percent_format).toMatch(/;0\.0%$/);
      expect(inspection.formula_cells.F6).toContain('$L$5');
      expect(inspection.formula_cells.F7).toContain('$L$6');
      expect(inspection.formula_cells.F10).toContain('F6');
      expect(inspection.formula_cells.F10).toContain('F7');
      expect(inspection.formula_cells.F22).toContain('F17');
      expect(inspection.formula_cells.F41).toBe('=SUM(F25,F37:F40)');
      expect(inspection.formula_cells.B85).toContain('B83');
      expect(inspection.formula_cells.L40).toMatch(/^=/);
      expect(inspection.has_sec_accession).toBe(true);
      expect(inspection.has_ref_error).toBe(false);
      const base = inspection.recalculated.base!;
      expect(Math.abs(base.equity_value - engineResults.equityValue) / engineResults.equityValue).toBeLessThan(0.001);
      expect(Math.abs(base.per_share - engineResults.impliedSharePrice)).toBeLessThanOrEqual(0.01);
      expect(base.wacc).toBeCloseTo(assumptions.wacc, 8);
      expect(base.formula_errors).toEqual([]);
      for (const checks of [base.customer_checks, base.revenue_checks, base.ebit_checks, base.fcff_checks]) {
        expect(checks.every((value) => typeof value === 'number' && Math.abs(value) < 1)).toBe(true);
      }
      const baseSensitivity = base.sensitivity[1];
      expect(baseSensitivity?.[0]).toBeLessThan(baseSensitivity?.[1] ?? 0);
      expect(baseSensitivity?.[1]).toBeLessThan(baseSensitivity?.[2] ?? 0);
      expect(baseSensitivity?.[2]).toBeLessThan(baseSensitivity?.[3] ?? 0);
      expect(baseSensitivity?.[3]).toBeLessThan(baseSensitivity?.[4] ?? 0);
      expect(baseSensitivity?.[2]).toBeCloseTo(base.per_share, 2);
      expect(inspection.recalculated.gross_adds!.equity_value).toBeGreaterThan(base.equity_value);
      expect(inspection.recalculated.higher_churn!.equity_value).toBeLessThan(base.equity_value);
      expect(inspection.recalculated.service_growth!.equity_value).toBeGreaterThan(base.equity_value);
      expect(inspection.recalculated.network_capex!.equity_value).toBeLessThan(base.equity_value);
      expect(inspection.recalculated.higher_wacc!.equity_value).toBeLessThan(base.equity_value);
      expect(inspection.recalculated.terminal_growth!.equity_value).toBeGreaterThan(base.equity_value);
      expect(inspection.recalculated.higher_debt!.per_share).toBeLessThan(base.per_share);
      expect(inspection.recalculated.diluted_shares!.per_share).toBeLessThan(base.per_share);
      expect(inspection.recalculated.restored!.equity_value).toBeCloseTo(base.equity_value, 2);
      expect(inspection.recalculated.restored!.per_share).toBeCloseTo(base.per_share, 4);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('maps AT&T subscriber, churn, segment, and broadband history from its live 10-K', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-telecom-facts-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });

    try {
      const payload = await new BackendApiClient(await backend.start()).getUnifiedCompany('T', 5);
      const facts = (payload.financials_native as unknown as {
        telecom_filing_facts?: Array<{
          concept: string;
          value: number;
          unit: string;
          unit_scale: string;
          fiscal_year: number;
          accession_number: string | null;
          filing_date: string | null;
          source_statement: string | null;
        }>;
      }).telecom_filing_facts ?? [];
      const factFor = (concept: string, year: number) => facts.find(
        (fact) => fact.concept === concept && fact.fiscal_year === year,
      );
      const expected = [
        ['TelecomWirelessSubscribers', 2025, 120_105, 'subscribers', 'thousands'],
        ['TelecomWirelessSubscribers', 2024, 117_851, 'subscribers', 'thousands'],
        ['TelecomWirelessSubscribers', 2023, 113_808, 'subscribers', 'thousands'],
        ['TelecomWirelessNetAdditions', 2025, 2_314, 'subscribers', 'thousands'],
        ['TelecomPostpaidPhoneNetAdditions', 2025, 1_551, 'subscribers', 'thousands'],
        ['TelecomPostpaidChurn', 2025, 1.05, 'percent', 'monthly'],
        ['TelecomPostpaidPhoneChurn', 2025, 0.90, 'percent', 'monthly'],
        ['TelecomPostpaidPhoneChurn', 2024, 0.76, 'percent', 'monthly'],
        ['TelecomPostpaidPhoneChurn', 2023, 0.81, 'percent', 'monthly'],
        ['TelecomMobilityServiceRevenue', 2025, 67_384, 'USD', 'millions'],
        ['TelecomMobilityEquipmentRevenue', 2025, 22_098, 'USD', 'millions'],
        ['TelecomMobilityRevenue', 2025, 89_482, 'USD', 'millions'],
        ['TelecomMobilityOperatingIncome', 2025, 27_196, 'USD', 'millions'],
        ['TelecomMobilityDepreciation', 2025, 10_422, 'USD', 'millions'],
        ['TelecomBusinessWirelineRevenue', 2025, 17_231, 'USD', 'millions'],
        ['TelecomBusinessWirelineOperatingIncome', 2025, -816, 'USD', 'millions'],
        ['TelecomConsumerWirelineRevenue', 2025, 14_183, 'USD', 'millions'],
        ['TelecomConsumerWirelineOperatingIncome', 2025, 1_547, 'USD', 'millions'],
        ['TelecomConsumerWirelineOperatingIncome', 2023, 651, 'USD', 'millions'],
        ['TelecomFiberBroadbandConnections', 2025, 10_406, 'subscribers', 'thousands'],
        ['TelecomConsumerWirelineBroadbandRevenue', 2025, 12_187, 'USD', 'millions'],
        ['TelecomBroadbandConnections', 2025, 14_704, 'subscribers', 'thousands'],
        ['TelecomBroadbandNetAdditions', 2025, 729, 'subscribers', 'thousands'],
        ['TelecomFiberBroadbandNetAdditions', 2025, 1_075, 'subscribers', 'thousands'],
        ['TelecomCommunicationsRevenue', 2025, 120_896, 'USD', 'millions'],
        ['TelecomLatinAmericaRevenue', 2025, 4_379, 'USD', 'millions'],
        ['TelecomCapitalExpenditures', 2025, 20_842, 'USD', 'millions'],
        ['TelecomWorkingCapitalChange', 2025, 1_986, 'USD', 'millions'],
        ['TelecomInterestBearingDebt', 2025, 136_100, 'USD', 'millions'],
        ['TelecomCostOfDebt', 2025, 4.2, 'percent', 'annual'],
      ] as const;

      for (const [concept, year, value, unit, unitScale] of expected) {
        const fact = factFor(concept, year);
        expect(fact?.value, `T ${concept} FY${year}`).toBe(value);
        expect(fact?.unit, `T ${concept} FY${year} unit`).toBe(unit);
        expect(fact?.unit_scale, `T ${concept} FY${year} scale`).toBe(unitScale);
        expect(fact?.accession_number, `T ${concept} FY${year} accession`).toBe('0000732717-26-000120');
        expect(fact?.filing_date, `T ${concept} FY${year} filing date`).toBe('2026-02-09');
        expect(fact?.source_statement, `T ${concept} FY${year} table label`).toMatch(/SEC 10-K/i);
      }
      expect(factFor('TelecomBroadbandConnections', 2022), 'the 2022 broadband population is not filled with a comparative growth-rate value')
        .toBeUndefined();
      for (const concept of ['TelecomWirelessSubscribers', 'TelecomPostpaidPhoneChurn', 'TelecomMobilityServiceRevenue']) {
        const years = facts.filter((fact) => fact.concept === concept).map((fact) => fact.fiscal_year).sort();
        expect(years.slice(-3), `T ${concept} has three consecutive annual observations`).toEqual([2023, 2024, 2025]);
      }

      const fy2025 = payload.canonical_financials.annual.find((item) => item.year === 2025)?.telecom;
      expect(fy2025?.wireless_subscribers.value).toBe(120_105_000);
      expect(fy2025?.postpaid_phone_churn.value).toBeCloseTo(0.009, 8);
      expect(fy2025?.mobility_revenue.value).toBe(89_482_000_000);
      expect(fy2025?.mobility_service_revenue.value).toBe(67_384_000_000);
      expect(fy2025?.mobility_operating_income.value).toBe(27_196_000_000);
      expect(fy2025?.broadband_connections.value).toBe(14_704_000);
      expect(fy2025?.fiber_broadband_connections.value).toBe(10_406_000);
      expect(fy2025?.consumer_broadband_revenue.value).toBe(12_187_000_000);
      expect(fy2025?.capital_expenditures.value).toBe(20_842_000_000);
      expect(fy2025?.working_capital_change.value).toBe(1_986_000_000);
      expect(fy2025?.interest_bearing_debt.value).toBe(136_100_000_000);
      expect(fy2025?.cost_of_debt.value).toBeCloseTo(0.042, 8);
      expect(fy2025?.working_capital_change.source).toBe('derived');
      expect(fy2025?.working_capital_change.sources).toHaveLength(6);
      expect(payload.canonical_financials.annual.find((item) => item.year === 2022)?.telecom?.broadband_connections.source)
        .toBe('missing');
      for (const line of [fy2025?.wireless_subscribers, fy2025?.postpaid_phone_churn, fy2025?.mobility_service_revenue]) {
        expect(line?.source).toBe('sec_native');
        expect(line?.sources[0]?.accession).toBe('0000732717-26-000120');
        expect(line?.sources[0]?.filed).toBe('2026-02-09');
      }
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('maps AGNC agency MBS yield, repo funding, tangible book, and dividends from live 10-Ks', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-mortgage-reit-facts-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {...process.env, HOME: home, DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite')},
    });
    try {
      const payload = await new BackendApiClient(await backend.start()).getUnifiedCompany('AGNC', 5);
      expect(payload.model_eligibility.required_input_readiness?.usd_reporting_currency,
        'AGNC mortgage-REIT route checks its reporting currency')
        .toBe(payload.canonical_financials.currency?.toUpperCase() === 'USD');
      const facts = (payload.financials_native as unknown as {
        mortgage_reit_filing_facts?: Array<{
          concept: string;
          value: number;
          unit: string;
          unit_scale: string;
          fiscal_year: number;
          accession_number: string | null;
          filing_date: string | null;
          source_statement: string | null;
        }>;
      }).mortgage_reit_filing_facts ?? [];
      const factFor = (concept: string, year: number) => facts.find(
        (fact) => fact.concept === concept && fact.fiscal_year === year,
      );
      const expected = [
        ['MortgageReitAverageAssetYield', 2025, 4.90, 'percent', 'annual'],
        ['MortgageReitAverageAssetYield', 2024, 4.70, 'percent', 'annual'],
        ['MortgageReitAverageAssetYield', 2023, 4.11, 'percent', 'annual'],
        ['MortgageReitAverageAggregateCostOfFunds', 2025, 2.98, 'percent', 'annual'],
        ['MortgageReitAverageNetInterestSpread', 2025, 1.92, 'percent', 'annual'],
        ['MortgageReitEconomicInterestIncome', 2025, 4_097, 'USD', 'millions'],
        ['MortgageReitEconomicInterestExpense', 2025, 2_276, 'USD', 'millions'],
        ['MortgageReitAverageRepoBorrowings', 2025, 64_472, 'USD', 'millions'],
        ['MortgageReitTangibleBookValuePerCommonShare', 2025, 8.88, 'USD per share', 'actual'],
        ['MortgageReitNetBookValuePerCommonShare', 2025, 9.35, 'USD per share', 'actual'],
        ['MortgageReitNetIncomeAvailableToCommon', 2025, 1_509, 'USD', 'millions'],
        ['MortgageReitPreferredDividends', 2025, 161, 'USD', 'millions'],
        ['MortgageReitCommonDividendsPerShareDeclared', 2025, 1.44, 'USD per share', 'actual'],
        ['MortgageReitPreferredEquityLiquidationPreference', 2025, 2_033, 'USD', 'millions'],
      ] as const;
      for (const [concept, year, value, unit, unitScale] of expected) {
        const fact = factFor(concept, year);
        expect(fact?.value, `AGNC ${concept} FY${year}`).toBe(value);
        expect(fact?.unit, `AGNC ${concept} FY${year} unit`).toBe(unit);
        expect(fact?.unit_scale, `AGNC ${concept} FY${year} scale`).toBe(unitScale);
        expect(fact?.accession_number, `AGNC ${concept} FY${year} accession`).toMatch(/^\d{10}-\d{2}-\d{6}$/);
        expect(fact?.filing_date, `AGNC ${concept} FY${year} filed date`).toMatch(/^20\d{2}-\d{2}-\d{2}$/);
        expect(fact?.source_statement, `AGNC ${concept} FY${year} disclosure`).toMatch(/SEC 10-K/i);
      }
      for (const concept of ['MortgageReitAverageAssetYield', 'MortgageReitAverageAggregateCostOfFunds', 'MortgageReitAverageNetInterestSpread']) {
        const years = facts.filter((fact) => fact.concept === concept).map((fact) => fact.fiscal_year).sort();
        expect(years.slice(-3), `AGNC ${concept} has three consecutive annual observations`).toEqual([2023, 2024, 2025]);
      }
      const fy2025 = payload.canonical_financials.annual.find((item) => item.year === 2025)?.mortgage_reit;
      expect(fy2025?.investment_securities_fair_value.value).toBe(81_789_000_000);
      expect(fy2025?.total_assets.value).toBe(115_077_000_000);
      expect(fy2025?.total_liabilities.value).toBe(102_684_000_000);
      expect(fy2025?.repo_and_other_debt.value).toBe(85_342_000_000);
      expect(fy2025?.total_stockholders_equity.value).toBe(12_393_000_000);
      expect(fy2025?.average_asset_yield.value).toBeCloseTo(0.049, 8);
      expect(fy2025?.average_aggregate_cost_of_funds.value).toBeCloseTo(0.0298, 8);
      expect(fy2025?.average_net_interest_spread.value).toBeCloseTo(0.0192, 8);
      expect(fy2025?.economic_interest_income.value).toBe(4_097_000_000);
      expect(fy2025?.economic_interest_expense.value).toBe(2_276_000_000);
      expect(fy2025?.economic_interest_income.value! - fy2025?.economic_interest_expense.value!).toBe(1_821_000_000);
      expect(fy2025?.average_investment_securities_at_cost.value).toBe(72_737_000_000);
      expect(fy2025?.average_repo_borrowings.value).toBe(64_472_000_000);
      expect(fy2025?.average_mortgage_borrowings.value).toBe(75_325_000_000);
      expect(fy2025?.tangible_book_value_per_common_share.value).toBe(8.88);
      expect(fy2025?.net_book_value_per_common_share.value).toBe(9.35);
      expect(fy2025?.preferred_equity_liquidation_preference.value).toBe(2_033_000_000);
      expect(fy2025?.period_end_common_shares.value).toBe(1_107_600_000);
      expect(fy2025?.net_income_available_to_common.value).toBe(1_509_000_000);
      expect(fy2025?.common_dividends_per_share.value).toBe(1.44);
      const fy2023 = payload.canonical_financials.annual.find((item) => item.year === 2023)?.mortgage_reit;
      expect(fy2023?.preferred_equity_liquidation_preference.value).toBe(1_688_000_000);
      expect((fy2023?.total_stockholders_equity.value! - fy2023?.preferred_equity_liquidation_preference.value!)
        / fy2023?.period_end_common_shares.value!).toBeCloseTo(fy2023?.net_book_value_per_common_share.value ?? Number.NaN, 2);
      expect(payload.model_eligibility.preferred_model).toBe('mortgage_reit_residual_income');
      expect(payload.model_eligibility.required_input_readiness?.agency_mreit_source_contract).toBe(true);
      expect(payload.model_eligibility.required_input_readiness?.three_year_average_asset_yield).toBe(true);
      expect(payload.model_eligibility.required_input_readiness?.opening_tangible_book_value).toBe(true);
      for (const line of [fy2025?.average_asset_yield, fy2025?.average_repo_borrowings, fy2025?.tangible_book_value_per_common_share]) {
        expect(line?.source).toBe('sec_native');
        expect(line?.sources[0]?.accession).toBe('0001423689-26-000043');
        expect(line?.sources[0]?.filed).toBe('2026-02-23');
      }
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('calculates a live AGNC mortgage-REIT spread, book-value, and residual-income forecast', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-mortgage-reit-engine-'));
    const backend = new LocalBackendProcess({backendDirectory: resolve(projectRoot, 'backend'),
      environment: {...process.env, HOME: home, DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite')}});
    try {
      const data = await new BackendApiClient(await backend.start()).getUnifiedCompany('AGNC', 5);
      const {mapCanonicalMortgageReitFinancialsToHistoricals} = await import('@/services/integration/sec/native-normalizer');
      const {buildSourcedMortgageReitModelAssumptions} = await import('@/services/valuation/mortgage-reit-assumption-policy');
      const {calculateMortgageReitValuation} = await import('@/services/valuation/mortgage-reit-model');
      if (!data.model_eligibility.supported_by_current_engine) {
        expect(data.model_eligibility.status).toBe('unsupported');
        expect(data.model_eligibility.model_route_available).toBe(false);
        return;
      }
      const history = mapCanonicalMortgageReitFinancialsToHistoricals(data.canonical_financials);
      const assumptions = buildSourcedMortgageReitModelAssumptions(data, history);
      const results = calculateMortgageReitValuation(history, assumptions);
      expect(history.years).toEqual([2022, 2023, 2024, 2025]);
      expect(results.mortgageReitForecasts).toHaveLength(5);
      for (const forecast of results.mortgageReitForecasts) {
        expect(forecast.aggregateCostOfFunds).toBeCloseTo(
          forecast.unhedgedCostOfFunds + forecast.hedgeCostOfFundsAdjustment,
          8,
        );
        expect(forecast.economicInterestExpense).toBeCloseTo(
          forecast.averageMortgageBorrowings * forecast.aggregateCostOfFunds,
          2,
        );
        expect(forecast.netInterestIncome).toBeCloseTo(forecast.economicInterestIncome - forecast.economicInterestExpense, 2);
        expect(forecast.earningsAvailableToCommon).toBeCloseTo(
          forecast.netInterestIncome + forecast.otherIncome - forecast.operatingExpenses - forecast.preferredDividends - forecast.taxes,
          2,
        );
        expect(forecast.bookValueRollforwardCheck).toBeCloseTo(0, 6);
        expect(forecast.residualIncomePerShare).toBeCloseTo(
          forecast.earningsPerShare - assumptions.costOfEquity * forecast.beginningTangibleBookValuePerCommonShare,
          4,
        );
      }
      expect(results.valuationBasis).toBe('equity');
      expect(results.enterpriseValue).toBeNull();
      expect(results.equityValue).toBeGreaterThan(0);
      expect(results.impliedSharePrice).toBeGreaterThan(0);
      expect(calculateMortgageReitValuation(history, {...assumptions, assetYieldChange: assumptions.assetYieldChange + 0.0025}).equityValue)
        .toBeGreaterThan(results.equityValue);
      expect(calculateMortgageReitValuation(history, {...assumptions, fundingCostChange: assumptions.fundingCostChange + 0.0025}).equityValue)
        .toBeLessThan(results.equityValue);
      expect(calculateMortgageReitValuation(history, {...assumptions, swapRatioChange: assumptions.swapRatioChange + 0.01}).equityValue)
        .toBeGreaterThan(results.equityValue);
      expect(calculateMortgageReitValuation(history, {...assumptions, swapNetPayRateChange: assumptions.swapNetPayRateChange + 0.005}).equityValue)
        .toBeLessThan(results.equityValue);
      expect(calculateMortgageReitValuation(history, {...assumptions, investmentAssetsToCommonEquity: assumptions.investmentAssetsToCommonEquity + 0.25}).equityValue)
        .toBeGreaterThan(results.equityValue);
      expect(calculateMortgageReitValuation(history, {...assumptions, mortgageBorrowingsToCommonEquity: assumptions.mortgageBorrowingsToCommonEquity + 0.25}).equityValue)
        .toBeLessThan(results.equityValue);
      expect(calculateMortgageReitValuation(history, {...assumptions, commonSharesOutstanding: assumptions.commonSharesOutstanding * 1.01}).equityValue)
        .toBeGreaterThan(results.equityValue);
      expect(calculateMortgageReitValuation(history, {...assumptions, costOfEquity: assumptions.costOfEquity + 0.005}).equityValue)
        .toBeLessThan(results.equityValue);
      expect(calculateMortgageReitValuation(history, {...assumptions, marketValueChangePerShare: assumptions.marketValueChangePerShare - 0.005}).equityValue)
        .toBeLessThan(results.equityValue);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('exports and recalculates a live AGNC mortgage-REIT model with editable formulas', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-mortgage-reit-workbook-'));
    const backend = new LocalBackendProcess({backendDirectory: resolve(projectRoot, 'backend'),
      environment: {...process.env, HOME: home, DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite')}});
    try {
      const data = await new BackendApiClient(await backend.start()).getUnifiedCompany('AGNC', 5);
      if (!data.model_eligibility.supported_by_current_engine) {
        expect(data.model_eligibility.status).toBe('unsupported');
        expect(data.model_eligibility.model_route_available).toBe(false);
        return;
      }
      const history = mapCanonicalMortgageReitFinancialsToHistoricals(data.canonical_financials);
      const {buildSourcedMortgageReitModelAssumptions} = await import('@/services/valuation/mortgage-reit-assumption-policy');
      const {calculateMortgageReitValuation} = await import('@/services/valuation/mortgage-reit-model');
      const {buildMortgageReitModelExportPayload} = await import('@/services/exporters/excel/mortgage-reit-payload');
      const profile = mapNativeProfile(data.profile, data.financials_native, data.market);
      const assumptions = buildSourcedMortgageReitModelAssumptions(data, history);
      const engineResults = calculateMortgageReitValuation(history, assumptions);
      const payload = buildMortgageReitModelExportPayload(profile, history, assumptions);
      expect(payload.valuationModel).toBe('mortgage_reit_residual_income');
      expect(() => parseDcfExportPayload(payload)).not.toThrow();

      const pythonScript = `import json, subprocess, sys
from pathlib import Path
from openpyxl import Workbook, load_workbook
from app.api.contracts import MortgageReitModelExportData
from app.services.excel_export.mappers.mortgage_reit_model import apply_mortgage_reit_model

with open(sys.argv[1], encoding='utf-8') as source:
    payload = json.load(source)
MortgageReitModelExportData.model_validate(payload['mortgageReitModel'])
workbook_path = Path(sys.argv[2])
workbook = Workbook()
apply_mortgage_reit_model(workbook, payload)
workbook.save(workbook_path)

variant_specs = {
    'higher_asset_yield': ('N7', lambda value: value + 0.0025),
    'higher_funding_cost': ('N9', lambda value: value + 0.0025),
    'higher_cost_of_equity': ('N27', lambda value: value + 0.005),
    'book_value_mark': ('N17', lambda value: value - 0.005),
    'higher_hedge_ratio': ('N26', lambda value: value + 0.01),
    'less_favorable_swap_rate': ('N33', lambda value: value + 0.005),
    'higher_investment_leverage': ('N10', lambda value: value + 0.25),
    'higher_mortgage_borrowings': ('N11', lambda value: value + 0.25),
    'higher_common_share_count': ('N21', lambda value: value * 1.01),
}
source_paths = {'base': workbook_path}
for name, (cell, edit) in variant_specs.items():
    variant = load_workbook(workbook_path, data_only=False)
    sheet = variant['Mortgage REIT Model']
    sheet[cell] = edit(float(sheet[cell].value))
    variant_path = workbook_path.with_name(f'{workbook_path.stem}-{name}.xlsx')
    variant.save(variant_path)
    source_paths[name] = variant_path

recalc_dir = workbook_path.parent / 'recalculated'
profile_dir = workbook_path.parent / 'libreoffice-profile'
recalc_dir.mkdir(parents=True, exist_ok=True)
profile_dir.mkdir(parents=True, exist_ok=True)
process = subprocess.run([
    sys.argv[3], '--headless', f'-env:UserInstallation={profile_dir.as_uri()}', '--convert-to', 'xlsx',
    '--outdir', str(recalc_dir), *[str(path) for path in source_paths.values()],
], capture_output=True, text=True, timeout=120)
if process.returncode != 0:
    raise RuntimeError(process.stderr or process.stdout or 'LibreOffice failed to recalculate mortgage-REIT workbooks.')

def output_for(name):
    cached = load_workbook(recalc_dir / source_paths[name].name, data_only=True)
    sheet = cached['Mortgage REIT Model']
    errors = [cell.coordinate for row in sheet.iter_rows() for cell in row
              if isinstance(cell.value, str) and cell.value.startswith('#')]
    return {
        'equity_value_mm': sheet['B72'].value,
        'per_share': sheet['B71'].value,
        'sensitivity': [[sheet[f'{column}{row}'].value for column in 'CDEFG'] for row in range(79, 84)],
        'net_interest_checks': [sheet[f'{column}65'].value for column in 'FGHIJ'],
        'book_checks': [sheet[f'{column}66'].value for column in 'FGHIJ'],
        'book_bridge_checks': [sheet[f'{column}35'].value for column in 'BCDE'],
        'balance_sheet_checks': [sheet[f'{column}36'].value for column in 'BCDE'],
        'formula_errors': errors,
    }

inspection = load_workbook(workbook_path, data_only=False)
sheet = inspection['Mortgage REIT Model']
review = inspection['Data Review']
formulas = {cell.coordinate: cell.value for row in sheet.iter_rows() for cell in row
            if isinstance(cell.value, str) and cell.value.startswith('=')}
review_text = ' '.join(str(cell.value) for row in review.iter_rows() for cell in row if cell.value is not None)
print(json.dumps({
    'sheets': inspection.sheetnames,
    'gaap_interest': sheet['E5'].value,
    'economic_interest': sheet['E8'].value,
    'economic_expense': sheet['E9'].value,
    'formula_cells': formulas,
    'input_color': sheet['N6'].font.color.rgb if sheet['N6'].font.color else None,
    'hedge_input_color': sheet['N26'].font.color.rgb if sheet['N26'].font.color else None,
    'formula_color': sheet['F43'].fill.fgColor.rgb,
    'has_sec_accession': '0001423689-26-000043' in review_text,
    'has_ref_error': any('#REF!' in str(formula) for formula in formulas.values()),
    'recalculated': {name: output_for(name) for name in source_paths},
}))`;
      const inputPath = join(home, 'agnc-mortgage-reit-export.json');
      const workbookPath = join(home, 'agnc-mortgage-reit-live.xlsx');
      await writeFile(inputPath, JSON.stringify(payload), 'utf8');
      const inspected = spawnSync(pythonPath, ['-c', pythonScript, inputPath, workbookPath,
        sofficePath], {
        cwd: resolve(projectRoot, 'backend'), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 180_000,
      });
      if (inspected.error) throw inspected.error;
      if (inspected.status !== 0) throw new Error(`AGNC mortgage REIT workbook inspection failed: ${inspected.stderr}`);
      const result = JSON.parse(inspected.stdout.trim().split(/\r?\n/).at(-1) ?? '{}') as {
        sheets: string[];
        gaap_interest: string;
        economic_interest: string;
        economic_expense: string;
        formula_cells: Record<string, string>;
        input_color: string | null;
        hedge_input_color: string | null;
        formula_color: string;
        has_sec_accession: boolean;
        has_ref_error: boolean;
        recalculated: Record<string, {
          equity_value_mm: number;
          per_share: number;
          sensitivity: Array<Array<number | null>>;
          net_interest_checks: Array<number | null>;
          book_checks: Array<number | null>;
          book_bridge_checks: Array<number | null>;
          balance_sheet_checks: Array<number | null>;
          formula_errors: string[];
        }>;
      };
      expect(result.sheets).toEqual(['Mortgage REIT Model', 'Data Review']);
      expect(result.gaap_interest).toBe(3_523);
      expect(result.economic_interest).toBe(4_097);
      expect(result.economic_expense).toBe(2_276);
      for (const cell of ['F43', 'F44', 'F45', 'F46', 'F47', 'F48', 'F49', 'F50', 'F54', 'F56', 'F57', 'F59', 'F61', 'F62', 'F64', 'B71', 'B72']) {
        expect(result.formula_cells[cell], `${cell} is a live workbook formula`).toMatch(/^=/);
      }
      expect(result.formula_cells.N19).toBe('=N27+N28*N29');
      expect(result.formula_cells.N34).toBe('=N8-N25*N32');
      expect(result.formula_cells.F46).toBe('=F44*F45');
      expect(result.formula_cells.F48).toBe('=F47+F46');
      expect(result.formula_cells.F50).toBe('=F43-F49');
      expect(result.formula_cells.F61).toBe('=F38+F57-F59+F60');
      expect(result.formula_cells.F62).toBe('=F57-$N$19*F38');
      expect(result.formula_cells.B71).toContain('SUM(F64:J64)');
      expect(result.input_color).toMatch(/0000FF$/);
      expect(result.hedge_input_color).toMatch(/0000FF$/);
      expect(result.has_sec_accession).toBe(true);
      expect(result.has_ref_error).toBe(false);
      const base = result.recalculated.base!;
      expect(Math.abs(base.equity_value_mm * 1_000_000 - engineResults.equityValue) / engineResults.equityValue)
        .toBeLessThan(0.001);
      expect(Math.abs(base.per_share - engineResults.impliedSharePrice)).toBeLessThanOrEqual(0.01);
      expect(base.formula_errors).toEqual([]);
      expect(base.net_interest_checks.every((value) => typeof value === 'number' && Math.abs(value) < 0.001)).toBe(true);
      expect(base.book_checks.every((value) => typeof value === 'number' && Math.abs(value) < 0.000001)).toBe(true);
      expect(base.book_bridge_checks.slice(1).every((value) => typeof value === 'number' && Math.abs(value) < 0.01)).toBe(true);
      expect(base.balance_sheet_checks.every((value) => typeof value === 'number' && Math.abs(value) < 0.001)).toBe(true);
      const baseSensitivity = base.sensitivity[2];
      expect(baseSensitivity?.[0]).toBeLessThan(baseSensitivity?.[1] ?? 0);
      expect(baseSensitivity?.[1]).toBeLessThan(baseSensitivity?.[2] ?? 0);
      expect(baseSensitivity?.[2]).toBeLessThan(baseSensitivity?.[3] ?? 0);
      expect(baseSensitivity?.[3]).toBeLessThan(baseSensitivity?.[4] ?? 0);
      expect(baseSensitivity?.[2]).toBeCloseTo(base.per_share, 2);
      expect(result.recalculated.higher_asset_yield!.equity_value_mm).toBeGreaterThan(base.equity_value_mm);
      expect(result.recalculated.higher_funding_cost!.equity_value_mm).toBeLessThan(base.equity_value_mm);
      expect(result.recalculated.higher_cost_of_equity!.per_share).toBeLessThan(base.per_share);
      expect(result.recalculated.book_value_mark!.per_share).toBeLessThan(base.per_share);
      expect(result.recalculated.higher_hedge_ratio!.equity_value_mm).toBeGreaterThan(base.equity_value_mm);
      expect(result.recalculated.less_favorable_swap_rate!.equity_value_mm).toBeLessThan(base.equity_value_mm);
      expect(result.recalculated.higher_investment_leverage!.equity_value_mm).toBeGreaterThan(base.equity_value_mm);
      expect(result.recalculated.higher_mortgage_borrowings!.equity_value_mm).toBeLessThan(base.equity_value_mm);
      expect(result.recalculated.higher_common_share_count!.equity_value_mm).toBeGreaterThan(base.equity_value_mm);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('maps live XOM production, prices, costs, reserves, segment earnings, CapEx, and working capital from 10-Ks', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-energy-facts-'));
    const backend = new LocalBackendProcess({backendDirectory: resolve(projectRoot, 'backend'),
      environment: {...process.env, HOME: home, DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite')}});
    try {
      const payload = await new BackendApiClient(await backend.start()).getUnifiedCompany('XOM', 5);
      const facts = (payload.financials_native as unknown as {
        energy_filing_facts?: Array<{
          concept: string;
          value: number;
          unit: string;
          unit_scale: string;
          fiscal_year: number;
          accession_number: string | null;
          filing_date: string | null;
          source_statement: string | null;
          source_components?: Array<{concept: string; value: number; accession_number: string; filing_date: string}>;
        }>;
      }).energy_filing_facts ?? [];
      const factFor = (concept: string, year: number) => facts.find(
        (fact) => fact.concept === concept && fact.fiscal_year === year,
      );
      const expected = [
        ['EnergyTotalLiquidsProduction', 2025, 3_329, 'barrels per day', 'thousands'],
        ['EnergyTotalNaturalGasProduction', 2025, 8_442, 'cubic feet per day', 'millions'],
        ['EnergyOilEquivalentProduction', 2025, 4_736, 'barrels of oil equivalent per day', 'thousands'],
        ['EnergyBitumenProduction', 2025, 385, 'barrels per day', 'thousands'],
        ['EnergySyntheticOilProduction', 2025, 68, 'barrels per day', 'thousands'],
        ['EnergyTotalCrudePrice', 2025, 65.18, 'USD per barrel', 'actual'],
        ['EnergyTotalNGLPrice', 2025, 23.64, 'USD per barrel', 'actual'],
        ['EnergyTotalBitumenPrice', 2025, 46.13, 'USD per barrel', 'actual'],
        ['EnergyTotalSyntheticOilPrice', 2025, 63.61, 'USD per barrel', 'actual'],
        ['EnergyTotalNaturalGasPrice', 2025, 4.28, 'USD per thousand cubic feet', 'actual'],
        ['EnergyProductionCostPerOilEquivalentBarrel', 2025, 10.20, 'USD per barrel of oil equivalent', 'actual'],
        ['EnergyTotalProvedOilEquivalentReserves', 2025, 19_311, 'barrels of oil equivalent', 'millions'],
        ['EnergyDevelopedOilEquivalentReserves', 2025, 12_304, 'barrels of oil equivalent', 'millions'],
        ['EnergyUndevelopedOilEquivalentReserves', 2025, 7_007, 'barrels of oil equivalent', 'millions'],
        ['EnergyUpstreamEarningsGAAP', 2025, 21_354, 'USD', 'millions'],
        ['EnergyProductsEarningsGAAP', 2025, 7_423, 'USD', 'millions'],
        ['EnergyChemicalProductsEarningsGAAP', 2025, 800, 'USD', 'millions'],
        ['EnergySpecialtyProductsEarningsGAAP', 2025, 2_857, 'USD', 'millions'],
        ['EnergyCorporateFinancingEarningsGAAP', 2025, -3_590, 'USD', 'millions'],
        ['EnergyCashCapex', 2025, 28_997, 'USD', 'millions'],
        ['EnergyWorkingCapitalInvestment', 2025, 7_728, 'USD', 'millions'],
        ['EnergyWeightedAverageDilutedShares', 2025, 4_305, 'shares', 'millions'],
        ['EnergyCurrentDebt', 2025, 9_296, 'USD', 'millions'],
        ['EnergyLongTermDebt', 2025, 34_241, 'USD', 'millions'],
        ['EnergyInterestBearingDebt', 2025, 43_537, 'USD', 'millions'],
        ['EnergyCorporateInterestRevenue', 2025, 1_212, 'USD', 'millions'],
        ['EnergyUpstreamDandD', 2025, 21_357, 'USD', 'millions'],
        ['EnergyUpstreamPPEAdditions', 2025, 25_362, 'USD', 'millions'],
        ['EnergyCashCapex', 2023, 23_228, 'USD', 'millions'],
        ['EnergyCashCapex', 2024, 25_647, 'USD', 'millions'],
      ] as const;
      for (const [concept, year, value, unit, scale] of expected) {
        const fact = factFor(concept, year);
        expect(fact?.value, `XOM ${concept} FY${year}`).toBe(value);
        expect(fact?.unit, `XOM ${concept} FY${year} unit`).toBe(unit);
        expect(fact?.unit_scale, `XOM ${concept} FY${year} scale`).toBe(scale);
        expect(fact?.accession_number, `XOM ${concept} FY${year} accession`).toMatch(/^\d{10}-\d{2}-\d{6}$/);
        expect(fact?.filing_date, `XOM ${concept} FY${year} filed date`).toMatch(/^20\d{2}-\d{2}-\d{2}$/);
        expect(fact?.source_statement, `XOM ${concept} FY${year} source table`).toMatch(/SEC 10-K/i);
      }
      for (const concept of [
        'EnergyTotalLiquidsProduction', 'EnergyTotalNaturalGasProduction', 'EnergyOilEquivalentProduction',
        'EnergyTotalCrudePrice', 'EnergyTotalNaturalGasPrice', 'EnergyProductionCostPerOilEquivalentBarrel',
        'EnergyTotalProvedOilEquivalentReserves', 'EnergyUpstreamEarningsGAAP',
      ]) {
        expect(facts.filter((fact) => fact.concept === concept).map((fact) => fact.fiscal_year).sort().slice(-3))
          .toEqual([2023, 2024, 2025]);
      }
      for (const concept of [
        'EnergyUpstreamDandD', 'EnergyEnergyProductsDandD', 'EnergyChemicalProductsDandD', 'EnergySpecialtyProductsDandD',
        'EnergyUpstreamPPEAdditions', 'EnergyEnergyProductsPPEAdditions', 'EnergyChemicalProductsPPEAdditions', 'EnergySpecialtyProductsPPEAdditions',
      ]) {
        expect(facts.filter((fact) => fact.concept === concept).map((fact) => fact.fiscal_year).sort().slice(-3), `${concept} filing coverage`)
          .toEqual([2023, 2024, 2025]);
      }
      for (const [concept, value] of [
        ['EnergyUpstreamDandD', 16_600], ['EnergyEnergyProductsDandD', 1_562],
        ['EnergyChemicalProductsDandD', 1_311], ['EnergySpecialtyProductsDandD', 315],
        ['EnergyUpstreamPPEAdditions', 18_589], ['EnergyEnergyProductsPPEAdditions', 2_561],
        ['EnergyChemicalProductsPPEAdditions', 2_375], ['EnergySpecialtyProductsPPEAdditions', 451],
      ] as const) {
        const fact = factFor(concept, 2023);
        expect(fact?.value, `FY2023 ${concept}`).toBe(value);
        expect(fact?.accession_number, `FY2023 ${concept} accession`).toMatch(/^\d{10}-\d{2}-\d{6}$/);
      }
      expect(factFor('EnergyTotalCrudePrice', 2025)?.source_statement?.toLowerCase()).toContain('consolidated subsidiaries and equity companies');
      const workingCapital = factFor('EnergyWorkingCapitalInvestment', 2025);
      expect(workingCapital?.source_components).toHaveLength(4);
      expect(workingCapital?.source_components?.every((component) => component.accession_number && component.filing_date)).toBe(true);
      const xom2025 = payload.canonical_financials.annual.find((item) => item.year === 2025);
      const segments = facts.filter((fact) => fact.fiscal_year === 2025 && fact.concept.startsWith('Energy') && fact.concept.endsWith('EarningsGAAP'));
      const segmentEarnings = segments.reduce((total, fact) => total + fact.value * 1_000_000, 0);
      expect(segmentEarnings).toBe(xom2025?.net_income.value);
      const energy2025 = xom2025?.energy;
      expect(energy2025?.liquids_production.value).toBe(3_329_000);
      expect(energy2025?.natural_gas_production_available_for_sale.value).toBe(8_442_000_000);
      expect(energy2025?.oil_equivalent_production.value).toBe(4_736_000);
      expect(energy2025?.average_crude_price.value).toBe(65.18);
      expect(energy2025?.average_ngl_price.value).toBe(23.64);
      expect(energy2025?.bitumen_production.value).toBe(385_000);
      expect(energy2025?.synthetic_oil_production.value).toBe(68_000);
      expect(energy2025?.average_bitumen_price.value).toBe(46.13);
      expect(energy2025?.average_synthetic_oil_price.value).toBe(63.61);
      expect(energy2025?.average_natural_gas_price.value).toBe(4.28);
      expect(energy2025?.average_production_cost_per_oil_equivalent_barrel.value).toBe(10.20);
      expect(energy2025?.proved_oil_equivalent_reserves.value).toBe(19_311_000_000);
      expect(energy2025?.proved_developed_oil_equivalent_reserves.value).toBe(12_304_000_000);
      expect(energy2025?.proved_undeveloped_oil_equivalent_reserves.value).toBe(7_007_000_000);
      expect(energy2025?.cash_capex.value).toBe(28_997_000_000);
      expect(energy2025?.operating_working_capital_investment.value).toBe(7_728_000_000);
      expect(energy2025?.upstream_depreciation_and_depletion.value).toBe(21_357_000_000);
      expect(energy2025?.upstream_ppe_additions_including_noncash.value).toBe(25_362_000_000);
      expect(energy2025?.weighted_average_diluted_shares.value).toBe(4_305_000_000);
      expect(energy2025?.interest_bearing_debt.value).toBe(43_537_000_000);
      expect(energy2025?.corporate_interest_revenue.value).toBe(1_212_000_000);
      expect(energy2025?.brent_2026_earnings_sensitivity.value).toBe(700_000_000);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('maps live PFE product revenues and regional patent-expiry disclosures from the 10-K', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-pharma-facts-'));
    const backend = new LocalBackendProcess({backendDirectory: resolve(projectRoot, 'backend'),
      environment: {...process.env, HOME: home, DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite')}});
    try {
      const payload = await new BackendApiClient(await backend.start()).getUnifiedCompany('PFE', 5);
      const facts = (payload.financials_native as unknown as {
        pharma_filing_facts?: Array<{
          metric: string;
          product_name: string;
          region: string | null;
          value: number;
          unit: string;
          unit_scale: string;
          fiscal_year: number;
          accession_number: string | null;
          filing_date: string | null;
          source_statement: string | null;
          reported_text?: string | null;
        }>;
      }).pharma_filing_facts ?? [];
      const factFor = (metric: string, productName: string, fiscalYear: number, region?: string) => facts.find((fact) =>
        fact.metric === metric && fact.product_name === productName && fact.fiscal_year === fiscalYear
        && (region === undefined || fact.region === region));
      for (const [product, fiscalYear, value] of [
        ['Eliquis (a)', 2023, 6_747], ['Eliquis (a)', 2024, 7_366], ['Eliquis (a)', 2025, 7_961],
        ['Vyndaqel family', 2023, 3_321], ['Vyndaqel family', 2024, 5_451], ['Vyndaqel family', 2025, 6_380],
        ['Xeljanz', 2025, 1_087], ['Ibrance', 2025, 4_122], ['Paxlovid (b)', 2025, 2_362],
      ] as const) {
        const fact = factFor('product_revenue', product, fiscalYear);
        expect(fact?.value, `PFE ${product} FY${fiscalYear} sales`).toBe(value);
        expect(fact?.unit).toBe('USD');
        expect(fact?.unit_scale).toBe('millions');
        expect(fact?.accession_number).toBe('0000078003-26-000026');
        expect(fact?.filing_date).toBe('2026-02-26');
        expect(fact?.source_statement).toMatch(/Significant Revenues by Product/i);
      }
      expect(facts.filter((fact) => fact.metric === 'product_revenue' && fact.product_name === 'Eliquis (a)')
        .map((fact) => fact.fiscal_year).sort()).toEqual([2023, 2024, 2025]);
      for (const [region, year] of [['us', 2027], ['major_europe', 2026], ['japan', 2026]] as const) {
        const fact = factFor('basic_patent_expiration_year', 'Eliquis', 2025, region);
        expect(fact?.value, `Eliquis ${region} patent year`).toBe(year);
        expect(fact?.unit).toBe('calendar year');
        expect(fact?.unit_scale).toBe('actual');
        expect(fact?.accession_number).toBe('0000078003-26-000026');
      }
      expect(factFor('pending_patent_term_extension_year', 'Vyndaqel/Vyndamax/Vynmac', 2025, 'us')?.value).toBe(2028);
      expect(factFor('basic_patent_expiration_year', 'Prevnar 20/Prevenar 20', 2025, 'us')?.value).toBe(2035);
      expect(factFor('marketable_securities', 'Short-term investments', 2025)?.value).toBe(12_454);
      const latest = payload.canonical_financials.annual.find((item) => item.year === 2025);
      expect(latest?.revenue.value).toBe(62_579_000_000);
      expect(payload.canonical_financials.annual.find((item) => item.year === 2023)?.revenue.value).toBe(59_553_000_000);
      expect(latest?.marketable_securities.value).toBe(12_454_000_000);
      expect(latest?.pharma?.reported_total_revenue.value).toBe(62_579_000_000);
      expect(latest?.pharma?.products.find((product) => product.product_name === 'Eliquis (a)')?.revenue.value)
        .toBe(7_961_000_000);
      expect(latest?.pharma?.patents.find((patent) =>
        patent.product_name === 'Eliquis' && patent.region === 'us' && patent.metric === 'basic_patent_expiration_year'
      )?.year.value).toBe(2027);
      const profile = mapNativeProfile(payload.profile, payload.financials_native, payload.market);
      const genericHistory = mapCanonicalFinancialsToHistoricals(payload.canonical_financials, payload.market, profile);
      expect(genericHistory.sourceData?.pharma).toBeUndefined();
      expect(Object.values(genericHistory.sourceData ?? {}).every((lines) =>
        lines.every((line) => line !== null && typeof line.source === 'string'))).toBe(true);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('checks live PFE mature-pharma source readiness before enabling a product DCF', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-pfe-readiness-'));
    const backend = new LocalBackendProcess({backendDirectory: resolve(projectRoot, 'backend'),
      environment: {...process.env, HOME: home, DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite')}});
    try {
      const payload = await new BackendApiClient(await backend.start()).getUnifiedCompany('PFE', 5);
      const readiness = payload.model_eligibility.required_input_readiness ?? {};
      const sourceChecks = Object.entries(readiness).filter(([name]) => name !== 'mature_pharma_product_dcf_route');
      // PFE peers are sector-table fallbacks (#60): staged for review but
      // never the ready median, so multiple-route readiness stays false.
      const fallbackMultipleKeys = [
        'multiple_three_current_ev_ebitda_peers',
        'multiple_three_current_ev_revenue_peers',
        'ev_ebitda_route',
        'revenue_multiple_route',
      ];
      const missing = sourceChecks.filter(([name, ready]) => ready !== true && !fallbackMultipleKeys.includes(name)).map(([name]) => name);
      const pharmaYears = payload.canonical_financials.annual.filter((item) => item.year >= 2023).map((item) => ({
        year: item.year, reportedRevenue: item.revenue.value,
        productTableRevenue: item.pharma?.reported_total_revenue.value,
        securities: item.marketable_securities,
      }));
      expect(missing, `PFE live source checks: ${JSON.stringify({readiness, pharmaYears})}`).toEqual([]);
      expect(payload.model_eligibility.operating_archetype).toBe('mature_pharma');
      expect(payload.model_eligibility.preferred_model).toBe('mature_pharma_product_dcf');
      expect(readiness.mature_pharma_product_dcf_route).toBe(true);
      for (const key of fallbackMultipleKeys) expect(readiness[key] ?? false).toBe(false);
      expect(payload.data_quality.peers?.fallback_used, 'PFE peers are fallback-flagged sector-table sets').toBe(true);
      expect(Object.entries(readiness).filter(([name]) => !fallbackMultipleKeys.includes(name)).every(([, ready]) => ready === true)).toBe(true);
      expect(payload.model_eligibility.supported_by_current_engine).toBe(true);
      expect(payload.model_eligibility.allowed_models).toEqual(['mature_pharma_product_dcf']);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('calculates a live PFE product, LOE, and unlevered pharma DCF', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-pfe-engine-'));
    const backend = new LocalBackendProcess({backendDirectory: resolve(projectRoot, 'backend'),
      environment: {...process.env, HOME: home, DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite')}});
    try {
      const data = await new BackendApiClient(await backend.start()).getUnifiedCompany('PFE', 5);
      const {mapCanonicalPharmaFinancialsToHistoricals} = await import('@/services/integration/sec/native-normalizer');
      const {buildSourcedMaturePharmaModelAssumptions} = await import('@/services/valuation/mature-pharma-assumption-policy');
      const {calculateMaturePharmaValuation} = await import('@/services/valuation/mature-pharma-model');
      const history = mapCanonicalPharmaFinancialsToHistoricals(data.canonical_financials);
      const assumptions = buildSourcedMaturePharmaModelAssumptions(data, history);
      const results = calculateMaturePharmaValuation(history, assumptions);
      expect(history.years).toEqual([2023, 2024, 2025]);
      expect(assumptions.products.length).toBe(history.annual.at(-1)?.pharma.products.length);
      expect(assumptions.products.find((item) => item.productName === 'Eliquis (a)')?.modeledGlobalLoeYear).toBe(2027);
      expect(assumptions.products.find((item) => item.productName === 'Paxlovid (b)')?.preLoeGrowthRate)
        .toBeCloseTo(2_362 / 5_716 - 1, 6);
      expect(assumptions.products.find((item) => item.productName === 'Paxlovid (b)')?.sourceNote).toContain('COVID');
      expect(results.maturePharmaForecasts).toHaveLength(5);
      for (const forecast of results.maturePharmaForecasts) {
        expect(forecast.revenueReconciliationCheck).toBeCloseTo(0, 3);
        expect(forecast.fcffIdentityCheck).toBeCloseTo(0, 3);
        expect(forecast.revenue).toBeGreaterThan(0);
        expect(forecast.fcff).toBeCloseTo(forecast.nopat + forecast.depreciation - forecast.capex - forecast.workingCapitalInvestment, 2);
      }
      expect(results.enterpriseValue).toBeGreaterThan(0);
      expect(results.equityValue).toBeGreaterThan(0);
      expect(results.impliedSharePrice).toBeGreaterThan(0);
      const eliquis = assumptions.products.findIndex((item) => item.productName === 'Eliquis (a)');
      const higherGrowth = structuredClone(assumptions);
      higherGrowth.products[eliquis]!.preLoeGrowthRate += 0.01;
      expect(calculateMaturePharmaValuation(history, higherGrowth).enterpriseValue).toBeGreaterThan(results.enterpriseValue);
      const earlierLoe = structuredClone(assumptions);
      earlierLoe.products[eliquis]!.modeledGlobalLoeYear = 2026;
      expect(calculateMaturePharmaValuation(history, earlierLoe).enterpriseValue).toBeLessThan(results.enterpriseValue);
      const steeperErosion = structuredClone(assumptions);
      steeperErosion.products[eliquis]!.firstYearErosionRate += 0.1;
      expect(calculateMaturePharmaValuation(history, steeperErosion).enterpriseValue).toBeLessThan(results.enterpriseValue);
      expect(calculateMaturePharmaValuation(history, {...assumptions, ebitMargin: assumptions.ebitMargin + 0.01}).enterpriseValue)
        .toBeGreaterThan(results.enterpriseValue);
      expect(calculateMaturePharmaValuation(history, {...assumptions, taxRate: assumptions.taxRate + 0.01}).enterpriseValue)
        .toBeLessThan(results.enterpriseValue);
      expect(calculateMaturePharmaValuation(history, {...assumptions, wacc: assumptions.wacc + 0.005}).enterpriseValue)
        .toBeLessThan(results.enterpriseValue);
      expect(calculateMaturePharmaValuation(history, {...assumptions, terminalGrowthRate: assumptions.terminalGrowthRate + 0.005}).enterpriseValue)
        .toBeGreaterThan(results.enterpriseValue);
      expect(calculateMaturePharmaValuation(history, {...assumptions, debt: assumptions.debt + 1_000_000_000}).equityValue)
        .toBeLessThan(results.equityValue);
      expect(calculateMaturePharmaValuation(history, {...assumptions, commonSharesOutstanding: assumptions.commonSharesOutstanding * 1.01}).impliedSharePrice)
        .toBeLessThan(results.impliedSharePrice);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('exports and recalculates a live PFE product-and-patent formula workbook', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-pfe-export-'));
    const backend = new LocalBackendProcess({backendDirectory: resolve(projectRoot, 'backend'),
      environment: {...process.env, HOME: home, DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite')}});
    try {
      const data = await new BackendApiClient(await backend.start()).getUnifiedCompany('PFE', 5);
      const {mapCanonicalPharmaFinancialsToHistoricals, mapNativeProfile} = await import('@/services/integration/sec/native-normalizer');
      const {buildSourcedMaturePharmaModelAssumptions} = await import('@/services/valuation/mature-pharma-assumption-policy');
      const {calculateMaturePharmaValuation} = await import('@/services/valuation/mature-pharma-model');
      const {buildMaturePharmaModelExportPayload} = await import('@/services/exporters/excel/mature-pharma-payload');
      const history = mapCanonicalPharmaFinancialsToHistoricals(data.canonical_financials);
      const assumptions = buildSourcedMaturePharmaModelAssumptions(data, history);
      const engine = calculateMaturePharmaValuation(history, assumptions);
      const profile = mapNativeProfile(data.profile, data.financials_native, data.market);
      const exportPayload = buildMaturePharmaModelExportPayload(profile, history, assumptions);
      expect(() => parseDcfExportPayload(exportPayload)).not.toThrow();
      const accession = history.annual.at(-1)?.pharma.products[0]?.revenue.sources[0]?.accession;
      expect(accession).toBe('0000078003-26-000026');
      const inputPath = join(home, 'pfe-mature-pharma-export.json');
      const workbookPath = join(home, 'pfe-mature-pharma-live.xlsx');
      await writeFile(inputPath, JSON.stringify(exportPayload), 'utf8');
      const pythonScript = String.raw`import json, subprocess, sys
from pathlib import Path
from openpyxl import Workbook, load_workbook
from app.api.contracts import MaturePharmaModelExportData
from app.services.excel_export.mappers.mature_pharma_model import apply_mature_pharma_model

with open(sys.argv[1], encoding='utf-8') as source:
    payload = json.load(source)
MaturePharmaModelExportData.model_validate(payload['maturePharmaModel'])
workbook_path = Path(sys.argv[2])
workbook = Workbook()
apply_mature_pharma_model(workbook, payload)
workbook.save(workbook_path)

model = load_workbook(workbook_path, data_only=False)['Mature Pharma Model']
def row_for(label):
    return next(row for row in range(1, model.max_row + 1) if model[f'A{row}'].value == label)
eliquis_row = next(row for row in range(1, model.max_row + 1) if model[f'A{row}'].value == 'Eliquis (a)')
total_revenue_row = row_for('Total revenue')
revenue_check_row = row_for('Product-table revenue reconciliation check')
fcff_row = row_for('Unlevered free cash flow')
enterprise_row = row_for('Enterprise value')
per_share_row = row_for('Implied value per diluted share')
sensitivity_start = next(row for row in range(1, model.max_row + 1) if model[f'A{row}'].value == 'Implied value per share sensitivity — WACC vs. terminal growth')

variant_specs = {
    'higher_product_growth': (f'O{eliquis_row}', lambda value: value + 0.01),
    'earlier_loe': (f'N{eliquis_row}', lambda value: value - 1),
    'higher_first_year_erosion': (f'P{eliquis_row}', lambda value: value + 0.1),
    'higher_margin': ('B23', lambda value: value + 0.01),
    'higher_tax': ('B17', lambda value: value + 0.01),
    'higher_capex': ('B25', lambda value: value + 0.01),
    'higher_wacc': ('B14', lambda value: value + 0.01),
    'higher_terminal_growth': ('B27', lambda value: value + 0.005),
    'higher_debt': ('B10', lambda value: value + 1000),
    'higher_shares': ('B7', lambda value: value * 1.01),
}
source_paths = {'base': workbook_path}
for name, (cell, edit) in variant_specs.items():
    variant = load_workbook(workbook_path, data_only=False)
    sheet = variant['Mature Pharma Model']
    sheet[cell] = edit(float(sheet[cell].value))
    variant_path = workbook_path.with_name(f'{workbook_path.stem}-{name}.xlsx')
    variant.save(variant_path)
    source_paths[name] = variant_path

recalc_dir = workbook_path.parent / 'recalculated'
profile_dir = workbook_path.parent / 'libreoffice-profile'
recalc_dir.mkdir(parents=True, exist_ok=True)
profile_dir.mkdir(parents=True, exist_ok=True)
process = subprocess.run([
    sys.argv[4], '--headless', f'-env:UserInstallation={profile_dir.as_uri()}',
    '--convert-to', 'xlsx', '--outdir', str(recalc_dir), *[str(path) for path in source_paths.values()],
], capture_output=True, text=True, timeout=120)
if process.returncode != 0:
    raise RuntimeError(process.stderr or process.stdout or 'LibreOffice failed to recalculate the PFE workbook.')

def output_for(name):
    cached = load_workbook(recalc_dir / source_paths[name].name, data_only=True)['Mature Pharma Model']
    errors = [cell.coordinate for row in cached.iter_rows() for cell in row if isinstance(cell.value, str) and cell.value.startswith('#')]
    return {
        'enterprise_value_mm': cached[f'B{enterprise_row}'].value,
        'equity_value_mm': cached[f'B{enterprise_row+1}'].value,
        'per_share': cached[f'B{per_share_row}'].value,
        'revenue_checks': [cached[f'{column}{revenue_check_row}'].value for column in 'CDE'],
        'sensitivity': [[cached[f'{column}{sensitivity_start+row}'].value for column in 'CDEFG'] for row in range(2, 7)],
        'formula_errors': errors,
    }

sheet = load_workbook(workbook_path, data_only=False)['Mature Pharma Model']
formulas = {cell.coordinate: cell.value for row in sheet.iter_rows() for cell in row if isinstance(cell.value, str) and cell.value.startswith('=')}
review = load_workbook(workbook_path, data_only=False)['Data Review']
review_text = ' '.join(str(cell.value) for row in review.iter_rows() for cell in row if cell.value is not None)
all_forecast_cells_are_formulas = all(
    isinstance(sheet[f'{column}{row}'].value, str) and sheet[f'{column}{row}'].value.startswith('=')
    for column in 'FGHIJ' for row in range(eliquis_row, total_revenue_row + 1)
)
print(json.dumps({
    'sheets': load_workbook(workbook_path, data_only=False).sheetnames,
    'eliquis_row': eliquis_row,
    'total_revenue_row': total_revenue_row,
    'revenue_check_row': revenue_check_row,
    'fcff_row': fcff_row,
    'enterprise_row': enterprise_row,
    'per_share_row': per_share_row,
    'sensitivity_start': sensitivity_start,
    'formulas': {key: formulas.get(key) for key in (f'F{eliquis_row}', f'F{total_revenue_row}', f'F{fcff_row}', f'B{enterprise_row}', f'B{per_share_row}')},
    'all_forecast_cells_are_formulas': all_forecast_cells_are_formulas,
    'input_font_color': sheet[f'N{eliquis_row}'].font.color.rgb if sheet[f'N{eliquis_row}'].font.color and sheet[f'N{eliquis_row}'].font.color.type == 'rgb' else None,
    'formula_font_color': sheet[f'F{eliquis_row}'].font.color.rgb if sheet[f'F{eliquis_row}'].font.color and sheet[f'F{eliquis_row}'].font.color.type == 'rgb' else None,
    'has_accession': sys.argv[3] in review_text,
    'has_ref_error': any('#REF!' in str(value) for value in formulas.values()),
    'recalculated': {name: output_for(name) for name in source_paths},
}))`;
      const inspected = spawnSync(pythonPath, ['-c', pythonScript, inputPath, workbookPath, accession!, sofficePath], {
        cwd: resolve(projectRoot, 'backend'), encoding: 'utf8', env: process.env,
      });
      if (inspected.error) throw inspected.error;
      if (inspected.status !== 0) throw new Error(`PFE workbook inspection failed: ${inspected.stderr}`);
      const result = JSON.parse(inspected.stdout.trim().split(/\r?\n/).at(-1) ?? '{}') as {
        sheets: string[];
        eliquis_row: number;
        total_revenue_row: number;
        revenue_check_row: number;
        fcff_row: number;
        enterprise_row: number;
        per_share_row: number;
        sensitivity_start: number;
        formulas: Record<string, string>;
        all_forecast_cells_are_formulas: boolean;
        input_font_color: string | null;
        formula_font_color: string | null;
        has_accession: boolean;
        has_ref_error: boolean;
        recalculated: Record<string, {
          enterprise_value_mm: number; equity_value_mm: number; per_share: number;
          revenue_checks: Array<number | null>; sensitivity: Array<Array<number | null>>; formula_errors: string[];
        }>;
      };
      expect(result.sheets).toEqual(['Mature Pharma Model', 'Data Review']);
      expect(result.formulas[`F${result.eliquis_row}`]).toMatch(/^=IF\(/);
      expect(result.formulas[`F${result.total_revenue_row}`]).toMatch(/^=SUM\(/);
      expect(result.formulas[`F${result.fcff_row}`]).toMatch(/^=/);
      expect(result.all_forecast_cells_are_formulas).toBe(true);
      expect(result.input_font_color).toMatch(/0000FF$/);
      expect(result.formula_font_color).toMatch(/000000$/);
      expect(result.has_accession).toBe(true);
      expect(result.has_ref_error).toBe(false);
      const base = result.recalculated.base!;
      expect(base.formula_errors).toEqual([]);
      expect(base.revenue_checks.every((value) => typeof value === 'number' && Math.abs(value) < 0.01)).toBe(true);
      expect(Math.abs(base.equity_value_mm * 1_000_000 - engine.equityValue) / engine.equityValue).toBeLessThan(0.001);
      expect(Math.abs(base.per_share - engine.impliedSharePrice)).toBeLessThanOrEqual(0.01);
      const center = base.sensitivity[2];
      expect(center?.[0]).toBeLessThan(center?.[1] ?? 0);
      expect(center?.[1]).toBeLessThan(center?.[2] ?? 0);
      expect(center?.[2]).toBeLessThan(center?.[3] ?? 0);
      expect(center?.[3]).toBeLessThan(center?.[4] ?? 0);
      expect(center?.[2]).toBeCloseTo(base.per_share, 2);
      expect(result.recalculated.higher_product_growth!.enterprise_value_mm).toBeGreaterThan(base.enterprise_value_mm);
      expect(result.recalculated.earlier_loe!.enterprise_value_mm).toBeLessThan(base.enterprise_value_mm);
      expect(result.recalculated.higher_first_year_erosion!.enterprise_value_mm).toBeLessThan(base.enterprise_value_mm);
      expect(result.recalculated.higher_margin!.enterprise_value_mm).toBeGreaterThan(base.enterprise_value_mm);
      expect(result.recalculated.higher_tax!.enterprise_value_mm).toBeLessThan(base.enterprise_value_mm);
      expect(result.recalculated.higher_capex!.enterprise_value_mm).toBeLessThan(base.enterprise_value_mm);
      expect(result.recalculated.higher_wacc!.enterprise_value_mm).toBeLessThan(base.enterprise_value_mm);
      expect(result.recalculated.higher_terminal_growth!.enterprise_value_mm).toBeGreaterThan(base.enterprise_value_mm);
      expect(result.recalculated.higher_debt!.per_share).toBeLessThan(base.per_share);
      expect(result.recalculated.higher_shares!.per_share).toBeLessThan(base.per_share);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('calculates a live XOM production, segment, reserve, and unlevered energy DCF', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-energy-engine-'));
    const backend = new LocalBackendProcess({backendDirectory: resolve(projectRoot, 'backend'),
      environment: {...process.env, HOME: home, DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite')}});
    try {
      const data = await new BackendApiClient(await backend.start()).getUnifiedCompany('XOM', 5);
      const {mapCanonicalEnergyFinancialsToHistoricals} = await import('@/services/integration/sec/native-normalizer');
      const {buildSourcedIntegratedEnergyModelAssumptions} = await import('@/services/valuation/integrated-energy-assumption-policy');
      const {calculateIntegratedEnergyValuation} = await import('@/services/valuation/integrated-energy-model');
      const history = mapCanonicalEnergyFinancialsToHistoricals(data.canonical_financials);
      const assumptions = buildSourcedIntegratedEnergyModelAssumptions(data, history);
      const results = calculateIntegratedEnergyValuation(history, assumptions);
      expect(history.years).toEqual([2023, 2024, 2025]);
      expect(results.integratedEnergyForecasts).toHaveLength(5);
      for (const forecast of results.integratedEnergyForecasts) {
        expect(forecast.productionGrossMargin).toBeCloseTo(forecast.upstreamProductionRevenue - forecast.upstreamProductionCosts, 2);
        expect(forecast.segmentEarningsReconciliationCheck).toBeCloseTo(0, 2);
        expect(forecast.fcffIdentityCheck).toBeCloseTo(0, 2);
        expect(forecast.reserveRollForwardCheck).toBeCloseTo(0, 3);
        expect(forecast.endingProvedReserves).toBeGreaterThan(0);
      }
      expect(results.valuationBasis).toBe('enterprise');
      expect(results.enterpriseValue).toBeGreaterThan(0);
      expect(results.equityValue).toBeGreaterThan(0);
      expect(results.impliedSharePrice).toBeGreaterThan(0);
      expect(calculateIntegratedEnergyValuation(history, {...assumptions, crudePriceChange: assumptions.crudePriceChange + 1}).enterpriseValue)
        .toBeGreaterThan(results.enterpriseValue);
      expect(calculateIntegratedEnergyValuation(history, {...assumptions, naturalGasPriceChange: assumptions.naturalGasPriceChange + 0.1}).enterpriseValue)
        .toBeGreaterThan(results.enterpriseValue);
      expect(calculateIntegratedEnergyValuation(history, {...assumptions, liquidsProductionGrowth: assumptions.liquidsProductionGrowth + 0.01}).enterpriseValue)
        .toBeGreaterThan(results.enterpriseValue);
      expect(calculateIntegratedEnergyValuation(history, {...assumptions, productionCostChangePerBoe: assumptions.productionCostChangePerBoe + 0.5}).enterpriseValue)
        .toBeLessThan(results.enterpriseValue);
      expect(calculateIntegratedEnergyValuation(history, {...assumptions, cashCapexPctRevenue: assumptions.cashCapexPctRevenue + 0.01}).enterpriseValue)
        .toBeLessThan(results.enterpriseValue);
      expect(calculateIntegratedEnergyValuation(history, {...assumptions, wacc: assumptions.wacc + 0.005}).enterpriseValue)
        .toBeLessThan(results.enterpriseValue);
      expect(calculateIntegratedEnergyValuation(history, {...assumptions, terminalGrowthRate: assumptions.terminalGrowthRate + 0.005}).enterpriseValue)
        .toBeGreaterThan(results.enterpriseValue);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('exports and recalculates a live XOM formula-driven integrated-energy workbook', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-energy-export-'));
    const backend = new LocalBackendProcess({backendDirectory: resolve(projectRoot, 'backend'),
      environment: {...process.env, HOME: home, DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite')}});
    try {
      const data = await new BackendApiClient(await backend.start()).getUnifiedCompany('XOM', 5);
      const {mapCanonicalEnergyFinancialsToHistoricals, mapNativeProfile} = await import('@/services/integration/sec/native-normalizer');
      const {buildSourcedIntegratedEnergyModelAssumptions} = await import('@/services/valuation/integrated-energy-assumption-policy');
      const {calculateIntegratedEnergyValuation} = await import('@/services/valuation/integrated-energy-model');
      const {buildIntegratedEnergyModelExportPayload} = await import('@/services/exporters/excel/integrated-energy-payload');
      const history = mapCanonicalEnergyFinancialsToHistoricals(data.canonical_financials);
      const assumptions = buildSourcedIntegratedEnergyModelAssumptions(data, history);
      const engine = calculateIntegratedEnergyValuation(history, assumptions);
      const profile = mapNativeProfile(data.profile, data.financials_native, data.market);
      const exportPayload = buildIntegratedEnergyModelExportPayload(profile, history, assumptions);
      const accession = history.annual.at(-1)?.energy.upstream_earnings_gaap.sources[0]?.accession;
      expect(accession).toMatch(/^\d{10}-\d{2}-\d{6}$/);
      const inputPath = join(home, 'xom-integrated-energy-export.json');
      const workbookPath = join(home, 'xom-integrated-energy-live.xlsx');
      await writeFile(inputPath, JSON.stringify(exportPayload), 'utf8');
      const pythonScript = String.raw`import json, subprocess, sys
from pathlib import Path
from openpyxl import Workbook, load_workbook
from app.services.excel_export.mappers.integrated_energy_model import apply_integrated_energy_model

with open(sys.argv[1], encoding='utf-8') as source:
    payload = json.load(source)
workbook_path = Path(sys.argv[2])
workbook = Workbook()
apply_integrated_energy_model(workbook, payload)
workbook.save(workbook_path)

variant_specs = {
    'higher_crude': ('L6', lambda value: value + 1.0),
    'higher_liquids': ('L11', lambda value: value + 0.01),
    'higher_production_cost': ('L13', lambda value: value + 0.5),
    'higher_capex': ('L19', lambda value: value + 0.01),
    'higher_wacc': ('L34', lambda value: value + 0.01),
    'higher_terminal_growth': ('L42', lambda value: value + 0.005),
    'higher_debt': ('L28', lambda value: value + 1000),
    'higher_shares': ('L26', lambda value: value * 1.01),
}
source_paths = {'base': workbook_path}
for name, (cell, edit) in variant_specs.items():
    variant = load_workbook(workbook_path, data_only=False)
    sheet = variant['Integrated Energy Model']
    sheet[cell] = edit(float(sheet[cell].value))
    variant_path = workbook_path.with_name(f'{workbook_path.stem}-{name}.xlsx')
    variant.save(variant_path)
    source_paths[name] = variant_path

recalc_dir = workbook_path.parent / 'recalculated'
profile_dir = workbook_path.parent / 'libreoffice-profile'
recalc_dir.mkdir(parents=True, exist_ok=True)
profile_dir.mkdir(parents=True, exist_ok=True)
process = subprocess.run([
    sys.argv[4], '--headless', f'-env:UserInstallation={profile_dir.as_uri()}',
    '--convert-to', 'xlsx', '--outdir', str(recalc_dir), *[str(path) for path in source_paths.values()],
], capture_output=True, text=True, timeout=120)
if process.returncode != 0:
    raise RuntimeError(process.stderr or process.stdout or 'LibreOffice failed to recalculate the XOM energy workbooks.')

def result_for(name):
    workbook = load_workbook(recalc_dir / source_paths[name].name, data_only=True)
    sheet = workbook['Integrated Energy Model']
    errors = [cell.coordinate for row in sheet.iter_rows() for cell in row if isinstance(cell.value, str) and cell.value.startswith('#')]
    return {
        'enterprise_value_mm': sheet['B94'].value,
        'equity_value_mm': sheet['B95'].value,
        'per_share': sheet['B97'].value,
        'pv_fcff_mm': sheet['B91'].value,
        'terminal_value_mm': sheet['B92'].value,
        'bridge_inputs_mm': [sheet[f'L{row}'].value for row in range(24, 32)],
        'wacc_inputs': [sheet[f'L{row}'].value for row in range(33, 43)],
        'sensitivity': [[sheet[f'{column}{row}'].value for column in 'CDEFG'] for row in range(103, 108)],
        'segment_check': [sheet[f'{column}37'].value for column in 'BCD'],
        'production_checks': [sheet[f'{column}10'].value for column in 'BCD'] + [sheet[f'{column}13'].value for column in 'BCD'],
        'reserve_checks': [sheet[f'{column}87'].value for column in 'EFGHI'],
        'formula_errors': errors,
    }

inspection = load_workbook(workbook_path, data_only=False)
sheet = inspection['Integrated Energy Model']
formulas = {cell.coordinate: cell.value for row in sheet.iter_rows() for cell in row if isinstance(cell.value, str) and cell.value.startswith('=')}
review = inspection['Data Review']
review_text = ' '.join(str(cell.value) for row in review.iter_rows() for cell in row if cell.value is not None)
forecast_rows = [*range(51, 65), *range(66, 90)]
forecast_cells_are_formulas = all(
    isinstance(sheet[f'{column}{row}'].value, str) and sheet[f'{column}{row}'].value.startswith('=')
    for column in 'EFGHI' for row in forecast_rows
)
print(json.dumps({
    'sheets': inspection.sheetnames,
    'labels': {cell: sheet[cell].value for cell in ('A37', 'A38', 'A39', 'A56', 'A58', 'A68', 'A69', 'A74', 'A79', 'A81', 'A87', 'A88', 'A89')},
    'formulas': formulas,
    'forecast_cells_are_formulas': forecast_cells_are_formulas,
    'editable_input_color': sheet['L6'].font.color.rgb if sheet['L6'].font.color and sheet['L6'].font.color.type == 'rgb' else None,
    'formula_color': sheet['E79'].font.color.rgb if sheet['E79'].font.color and sheet['E79'].font.color.type == 'rgb' else None,
    'has_sec_accession': sys.argv[3] in review_text,
    'has_ref_error': any('#REF!' in str(formula) for formula in formulas.values()),
    'recalculated': {name: result_for(name) for name in source_paths},
}))`;
      const inspected = spawnSync(pythonPath, ['-c', pythonScript, inputPath, workbookPath, accession!, sofficePath], {
        cwd: resolve(projectRoot, 'backend'), encoding: 'utf8', env: process.env,
      });
      if (inspected.error) throw inspected.error;
      if (inspected.status !== 0) throw new Error(`XOM workbook inspection failed: ${inspected.stderr}`);
      const result = JSON.parse(inspected.stdout.trim().split(/\r?\n/).at(-1) ?? '{}') as {
        sheets: string[];
        labels: Record<string, string>;
        formulas: Record<string, string>;
        forecast_cells_are_formulas: boolean;
        editable_input_color: string | null;
        formula_color: string | null;
        has_sec_accession: boolean;
        has_ref_error: boolean;
        recalculated: Record<string, {
          enterprise_value_mm: number;
          equity_value_mm: number;
          per_share: number;
          pv_fcff_mm: number;
          terminal_value_mm: number;
          bridge_inputs_mm: number[];
          wacc_inputs: number[];
          sensitivity: Array<Array<number | null>>;
          segment_check: Array<number | null>;
          production_checks: Array<number | null>;
          reserve_checks: Array<number | null>;
          formula_errors: string[];
        }>;
      };
      expect(result.sheets).toEqual(['Integrated Energy Model', 'Data Review']);
      expect(result.labels.A56).toContain('Total liquids production');
      expect(result.labels.A58).toContain('Oil-equivalent production');
      expect(result.labels.A68).toContain('gross margin');
      expect(result.labels.A69).toContain('Upstream GAAP');
      expect(result.labels.A74).toContain('NOPAT');
      expect(result.labels.A79).toContain('free cash flow');
      expect(result.labels.A81).toContain('Present value');
      expect(result.formulas.E56).toBe('=SUM(E51:E55)');
      expect(result.formulas.E58).toBe('=E56+E57/6');
      expect(result.formulas.E69).toBe('=$D$25+(E68-$D$24)*$L$23');
      expect(result.formulas.E74).toBe('=SUM(E69:E73)');
      expect(result.formulas.E79).toBe('=E74+E76-E77-E78');
      expect(result.formulas.E81).toBe('=E79*E80');
      expect(result.formulas.B95).toBe('=B94+L27+L29-L28-L30-L31');
      expect(result.formulas.B97).toBe('=B95/L26');
      expect(result.forecast_cells_are_formulas).toBe(true);
      expect(result.editable_input_color).toMatch(/0000FF$/);
      expect(result.formula_color).toMatch(/000000$/);
      expect(result.has_sec_accession).toBe(true);
      expect(result.has_ref_error).toBe(false);
      const base = result.recalculated.base!;
      expect(Math.abs(base.equity_value_mm * 1_000_000 - engine.equityValue) / engine.equityValue).toBeLessThan(0.001);
      expect(Math.abs(base.per_share - engine.impliedSharePrice), JSON.stringify({excel: base, engine: {
        enterpriseValue: engine.enterpriseValue,
        equityValue: engine.equityValue,
        impliedSharePrice: engine.impliedSharePrice,
        wacc: engine.wacc,
        assumptionsWacc: assumptions.wacc,
        terminalGrowth: assumptions.terminalGrowthRate,
        terminalValue: engine.terminalValue,
        pvTerminalValue: engine.pvTerminalValue,
      }})).toBeLessThanOrEqual(0.01);
      expect(base.formula_errors).toEqual([]);
      expect(base.segment_check.every((value) => typeof value === 'number' && Math.abs(value) < 2)).toBe(true);
      expect(base.production_checks.every((value) => typeof value === 'number' && Math.abs(value) < 5)).toBe(true);
      expect(base.reserve_checks.every((value) => typeof value === 'number' && Math.abs(value) < 0.000001)).toBe(true);
      const sensitivity = base.sensitivity[2];
      expect(sensitivity?.[0]).toBeLessThan(sensitivity?.[1] ?? 0);
      expect(sensitivity?.[1]).toBeLessThan(sensitivity?.[2] ?? 0);
      expect(sensitivity?.[2]).toBeLessThan(sensitivity?.[3] ?? 0);
      expect(sensitivity?.[3]).toBeLessThan(sensitivity?.[4] ?? 0);
      expect(sensitivity?.[2]).toBeCloseTo(base.per_share, 2);
      expect(result.recalculated.higher_crude!.enterprise_value_mm).toBeGreaterThan(base.enterprise_value_mm);
      expect(result.recalculated.higher_liquids!.enterprise_value_mm).toBeGreaterThan(base.enterprise_value_mm);
      expect(result.recalculated.higher_production_cost!.enterprise_value_mm).toBeLessThan(base.enterprise_value_mm);
      expect(result.recalculated.higher_capex!.enterprise_value_mm).toBeLessThan(base.enterprise_value_mm);
      expect(result.recalculated.higher_wacc!.enterprise_value_mm).toBeLessThan(base.enterprise_value_mm);
      expect(result.recalculated.higher_terminal_growth!.enterprise_value_mm).toBeGreaterThan(base.enterprise_value_mm);
      expect(result.recalculated.higher_debt!.per_share).toBeLessThan(base.per_share);
      expect(result.recalculated.higher_shares!.per_share).toBeLessThan(base.per_share);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('maps AUM and advisory-fee history from live traditional asset-manager 10-Ks', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-asset-manager-facts-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });

    try {
      const client = new BackendApiClient(await backend.start());
      for (const ticker of ['BLK', 'TROW']) {
        const payload = await client.getUnifiedCompany(ticker, 5);
        const filingFacts = (payload.financials_native as unknown as {
          asset_management_filing_facts?: Array<{
            concept: string;
            value: number;
            unit: string;
            unit_scale: string;
            fiscal_year: number;
            accession_number: string | null;
            filing_date: string | null;
            source_statement: string | null;
            source_components?: Array<{
              concept: string;
              value: number;
              unit_scale: string;
              fiscal_year: number;
              accession_number: string | null;
              filing_date: string | null;
              source_statement: string | null;
            }>;
          }>;
        }).asset_management_filing_facts ?? [];
        const aum = filingFacts.filter((fact) => fact.concept === 'AssetManagerAum');
        const advisoryFees = filingFacts.filter((fact) => fact.concept === 'AssetManagerBaseFees');
        const performanceFees = filingFacts.filter((fact) => fact.concept === 'AssetManagerPerformanceFees');
        const annualFact = (concept: string, year: number) => filingFacts.find(
          (fact) => fact.concept === concept && fact.fiscal_year === year,
        );
        const consecutiveYears = (facts: typeof aum): boolean => {
          const years = [...new Set(facts.map((fact) => fact.fiscal_year))].sort((left, right) => left - right);
          const recentYears = years.slice(-3);
          return recentYears.length >= 3 && recentYears.every((year, index) => index === 0 || year === recentYears[index - 1] + 1);
        };

        expect(consecutiveYears(aum), `${ticker} has three consecutive filed AUM observations: ${JSON.stringify(aum.map((fact) => fact.fiscal_year))}`).toBe(true);
        expect(consecutiveYears(advisoryFees), `${ticker} has three consecutive filed advisory-fee observations: ${JSON.stringify(advisoryFees.map((fact) => fact.fiscal_year))}`).toBe(true);
        expect(consecutiveYears(performanceFees), `${ticker} has three consecutive filed performance-fee observations: ${JSON.stringify(performanceFees.map((fact) => fact.fiscal_year))}`).toBe(true);
        const latestAum = aum.reduce((latest, fact) => fact.fiscal_year > latest.fiscal_year ? fact : latest);
        const aumInMillions = latestAum.value * ({thousands: 0.001, millions: 1, billions: 1000}[latestAum.unit_scale] ?? 0);
        expect(aumInMillions, `${ticker} filed AUM has the correct unit scale`).toBeGreaterThan(1_000_000);
        for (const fact of [...aum, ...advisoryFees, ...performanceFees]) {
          expect(fact.value, `${ticker} ${fact.concept} is positive`).toBeGreaterThan(0);
          expect(fact.unit, `${ticker} ${fact.concept} is a reported currency amount`).toBe('USD');
          expect(['thousands', 'millions', 'billions'].includes(fact.unit_scale), `${ticker} ${fact.concept} retains a source scale`).toBe(true);
          expect(fact.accession_number, `${ticker} ${fact.concept} retains an SEC accession`).toMatch(/^\d{10}-\d{2}-\d{6}$/);
          expect(fact.filing_date, `${ticker} ${fact.concept} retains a filing date`).toMatch(/^20\d{2}-\d{2}-\d{2}$/);
          expect(fact.source_statement, `${ticker} ${fact.concept} identifies its filed table`).toMatch(/SEC 10-K/i);
        }
        if (ticker === 'BLK') {
          const openingAum = annualFact('AssetManagerAum', 2024);
          const endingAum = annualFact('AssetManagerAum', 2025);
          const netFlows = annualFact('AssetManagerNetFlows', 2025);
          const realizations = annualFact('AssetManagerRealizations', 2025);
          const acquisitions = annualFact('AssetManagerAcquisitions', 2025);
          const marketChange = annualFact('AssetManagerMarketChange', 2025);
          const fxChange = annualFact('AssetManagerFxChange', 2025);
          const bridge = [netFlows, realizations, acquisitions, marketChange, fxChange];
          expect(openingAum?.value).toBe(11_551_251);
          expect(endingAum?.value).toBe(14_041_518);
          expect(netFlows?.value).toBe(698_261);
          expect(realizations?.value).toBe(-33_125);
          expect(acquisitions?.value).toBe(120_961);
          expect(marketChange?.value).toBe(1_483_629);
          expect(fxChange?.value).toBe(220_541);
          expect(bridge.every((fact) => fact?.unit_scale === 'millions'
            && fact.accession_number === endingAum?.accession_number
            && fact.filing_date === endingAum?.filing_date
            && /AUM change by client region, Total row/i.test(fact.source_statement ?? '')))
            .toBe(true);
          expect(openingAum!.value + bridge.reduce((sum, fact) => sum + fact!.value, 0))
            .toBeCloseTo(endingAum!.value, 6);
          const canonicalBridge = payload.canonical_financials.annual.find((item) => item.year === 2025)?.asset_manager;
          expect(canonicalBridge?.net_flows.value).toBe(698_261_000_000);
          expect(canonicalBridge?.realizations.value).toBe(-33_125_000_000);
          expect(canonicalBridge?.acquisitions.value).toBe(120_961_000_000);
          expect(canonicalBridge?.market_change.value).toBe(1_483_629_000_000);
          expect(canonicalBridge?.fx_change.value).toBe(220_541_000_000);
          expect(canonicalBridge?.scope_change.value).toBeCloseTo(0, 6);
          expect(canonicalBridge?.depreciation.value).toBe(1_126_000_000);
          expect(canonicalBridge?.working_capital_change.value).toBe(189_000_000);
          const blackRockRevenueLines = canonicalBridge as unknown as Record<string, {value: number | null}>;
          const blackRockRevenueComponents = [
            'base_fees', 'performance_fees', 'securities_lending_revenue', 'technology_revenue',
            'distribution_revenue', 'other_revenue',
          ].map((field) => blackRockRevenueLines[field]?.value);
          expect(blackRockRevenueComponents.every((value) => typeof value === 'number')).toBe(true);
          expect(blackRockRevenueComponents.reduce((sum, value) => sum + (value ?? 0), 0))
            .toBe(payload.canonical_financials.latest?.revenue.value);
          expect(blackRockRevenueLines.unmapped_revenue?.value).toBe(0);
        }
        if (ticker === 'TROW') {
          const openingAum = annualFact('AssetManagerAum', 2024);
          const endingAum = annualFact('AssetManagerAum', 2025);
          const netFlows = annualFact('AssetManagerNetFlows', 2025);
          const marketChange = annualFact('AssetManagerMarketChange', 2025);
          const scopeChange = annualFact('AssetManagerScopeChange', 2025);
          expect(openingAum?.value).toBeCloseTo(1606.6, 6);
          expect(endingAum?.value).toBeCloseTo(1775.6, 6);
          expect(netFlows?.value).toBeCloseTo(-56.9, 6);
          expect(marketChange?.value).toBeCloseTo(216.7, 6);
          expect(scopeChange?.value).toBeCloseTo(9.2, 6);
          expect([netFlows, marketChange, scopeChange].every((fact) => fact?.unit_scale === 'billions'
            && fact.accession_number === endingAum?.accession_number
            && /SEC 10-K AUM rollforward table/i.test(fact.source_statement ?? '')))
            .toBe(true);
          expect(openingAum!.value + netFlows!.value + marketChange!.value + scopeChange!.value)
            .toBeCloseTo(endingAum!.value, 6);
          const canonicalBridge = payload.canonical_financials.annual.find((item) => item.year === 2025)?.asset_manager;
          expect(canonicalBridge?.net_flows.value).toBe(-56_900_000_000);
          expect(canonicalBridge?.market_change.value).toBe(216_700_000_000);
          expect(canonicalBridge?.scope_change.value).toBe(9_200_000_000);
          const derivedPriorAum = aum.find((fact) => fact.fiscal_year === 2022);
          expect(derivedPriorAum?.value, 'TROW FY2022 AUM is derived from disclosed FY2023 AUM change').toBeCloseTo(1274.7, 6);
          expect(derivedPriorAum?.source_statement).toMatch(/derived as current AUM less reported increase/i);
          expect(derivedPriorAum?.source_components?.map((source) => source.concept)).toEqual(expect.arrayContaining([
            'ReportedCurrentYearEndAum', 'ReportedAnnualAumChange',
          ]));
          const canonicalPriorAum = payload.canonical_financials.annual.find((item) => item.year === 2022)?.asset_manager?.aum;
          expect(canonicalPriorAum?.source).toBe('derived');
          expect(canonicalPriorAum?.sources.map((source) => source.concept)).toEqual(expect.arrayContaining([
            'ReportedCurrentYearEndAum', 'ReportedAnnualAumChange',
          ]));
          expect(canonicalPriorAum?.sources.find((source) => source.concept === 'ReportedCurrentYearEndAum')?.reported_value)
            .toBeCloseTo(1444.5, 6);
          expect(canonicalPriorAum?.sources.find((source) => source.concept === 'ReportedAnnualAumChange')?.reported_value)
            .toBeCloseTo(169.8, 6);
          const trowAssetManager = payload.canonical_financials.latest?.asset_manager;
          expect(trowAssetManager?.depreciation.value,
            'TROW filed property and software depreciation is mapped for FCFF').toBe(405_800_000);
          expect(trowAssetManager?.acquisition_amortization.value,
            'TROW filed acquisition-related amortization is separately mapped for FCFF').toBe(199_700_000);
          expect(trowAssetManager?.working_capital_change.value,
            'TROW filed changes in operating assets and liabilities are sign-normalized for FCFF').toBe(-169_800_000);
          const trowRevenueLines = trowAssetManager as unknown as Record<string, {value: number | null}>;
          expect(trowRevenueLines.administrative_other_revenue?.value).toBe(506_300_000);
          expect(trowRevenueLines.capital_allocation_income?.value).toBe(81_200_000);
          expect(trowRevenueLines.distribution_revenue?.value).toBe(87_600_000);
          expect([
            'base_fees', 'performance_fees', 'administrative_other_revenue', 'capital_allocation_income', 'distribution_revenue',
          ].map((field) => trowRevenueLines[field]?.value).reduce((sum, value) => sum + (value ?? 0), 0))
            .toBe(payload.canonical_financials.latest?.revenue.value);
          expect(trowRevenueLines.unmapped_revenue?.value).toBe(0);
          expect(trowAssetManager?.depreciation.sources[0]?.statement).toMatch(/Statements of Cash Flows/i);
          expect(trowAssetManager?.acquisition_amortization.sources[0]?.statement).toMatch(/Statements of Cash Flows/i);
        }
        const annual = payload.canonical_financials.annual.slice(-3);
        expect(annual).toHaveLength(3);
        for (const year of annual) {
          const manager = year.asset_manager;
          if (!manager) throw new Error(`${ticker} FY${year.year} canonical AUM schedule is missing.`);
          expect(manager.aum.value, `${ticker} FY${year.year} AUM is normalized to USD`).toBeGreaterThan(0);
          expect(manager.base_fees.value, `${ticker} FY${year.year} advisory fees are normalized to USD`).toBeGreaterThan(0);
          expect(manager.aum.sources.every((source) => source.accession && source.filed), `${ticker} FY${year.year} AUM retains filing provenance`).toBe(true);
          const feeYieldLines = manager as unknown as {
            average_aum?: {value: number | null; sources: unknown[]};
            base_fee_yield?: {value: number | null; sources: unknown[]; method: string};
          };
          if (!feeYieldLines.average_aum || feeYieldLines.average_aum.value === null ||
              !feeYieldLines.base_fee_yield || feeYieldLines.base_fee_yield.value === null) {
            throw new Error(`${ticker} FY${year.year} canonical average AUM fee-yield schedule is missing.`);
          }
          expect(feeYieldLines.average_aum.value, `${ticker} FY${year.year} average AUM is positive`).toBeGreaterThan(0);
          expect(feeYieldLines.average_aum.sources.length, `${ticker} FY${year.year} average AUM retains beginning and ending filings`).toBeGreaterThanOrEqual(2);
          expect(feeYieldLines.base_fee_yield.value, `${ticker} FY${year.year} base-fee yield uses average AUM`)
            .toBeCloseTo(manager.base_fees.value! / feeYieldLines.average_aum.value, 10);
          expect(feeYieldLines.base_fee_yield.method).toBe('base_advisory_fees_divided_by_average_aum');
        }
      }
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('reads Invesco Ending AUM rather than a neighboring net-flow total', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-ivz-aum-fact-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });

    try {
      const payload = await new BackendApiClient(await backend.start()).getUnifiedCompany('IVZ', 5);
      const facts = (payload.financials_native as unknown as {
        asset_management_filing_facts?: Array<{
          concept: string;
          value: number;
          unit_scale: string;
          fiscal_year: number;
          source_statement: string | null;
          accession_number: string | null;
          filing_date: string | null;
        }>;
      }).asset_management_filing_facts ?? [];
      const currentAum = facts.find((fact) => fact.concept === 'AssetManagerAum' && fact.fiscal_year === 2025);
      expect(currentAum?.value).toBeCloseTo(2169.9, 6);
      expect(currentAum?.unit_scale).toBe('billions');
      expect(currentAum?.source_statement).toContain('Ending AUM row');
      expect(currentAum?.accession_number).toMatch(/^\d{10}-\d{2}-\d{6}$/);
      expect(currentAum?.filing_date).toBe('2026-02-24');
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('classifies traditional and alternative asset managers outside the bank model', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-asset-manager-classification-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });

    try {
      const client = new BackendApiClient(await backend.start());
      for (const [ticker, subtype] of [
        ['BLK', 'traditional_asset_manager'],
        ['TROW', 'traditional_asset_manager'],
        ['IVZ', 'traditional_asset_manager'],
        // BX/KKR file no alternative-marker text (name/industry/sic) and no
        // parseable alt-manager tables, so text-based detection resolves them
        // traditional; they stay blocked from ready either way (follow-up:
        // fact-based alternative detection).
        ['BX', 'traditional_asset_manager'],
        ['KKR', 'traditional_asset_manager'],
      ] as const) {
        const payload = await client.getUnifiedCompany(ticker, 5);
        expect(payload.model_eligibility.company_type, `${ticker} financial subtype`).toBe('asset_manager');
        expect(payload.model_eligibility.subtype, `${ticker} asset-manager subtype`).toBe(subtype);
        expect(payload.model_eligibility.preferred_model, `${ticker} uses the dedicated asset-manager route`).toBe('asset_manager_aum_dcf');
        const enabled = ticker === 'BLK' || ticker === 'TROW';
        expect(payload.model_eligibility.supported_by_current_engine, `${ticker} route eligibility`).toBe(enabled);
        // Non-enabled routes are preserved as input_required (never-unsupported
        // invariant), so every ticker keeps its source-ready specialist route.
        expect(payload.model_eligibility.allowed_models, `${ticker} has only its source-ready specialist route`)
          .toEqual(['asset_manager_aum_dcf']);
        expect(payload.model_eligibility.blocked_models.some((item) => item.model === 'asset_manager_aum_dcf'),
          `${ticker} asset-manager route block state`).toBe(!enabled);
        if (subtype === 'traditional_asset_manager') {
          const noParsedHistory = ticker === 'BX' || ticker === 'KKR';
          expect(payload.model_eligibility.required_input_readiness?.three_consecutive_filed_aum_years,
            `${ticker} has three consecutive AUM years`).toBe(!noParsedHistory);
          expect(payload.model_eligibility.required_input_readiness?.three_consecutive_reconciled_fee_revenues,
            `${ticker} filed fee components reconcile to total revenue`).toBe(!noParsedHistory && ticker !== 'IVZ');
          expect(payload.model_eligibility.required_input_readiness?.three_consecutive_filed_net_flow_years,
            `${ticker} has three consecutive filed net-flow years`).toBe(!noParsedHistory && ticker !== 'IVZ');
          expect(payload.model_eligibility.required_input_readiness?.three_consecutive_filed_market_change_years,
            `${ticker} has three consecutive filed market-change years`).toBe(!noParsedHistory && ticker !== 'IVZ');
          expect(payload.model_eligibility.required_input_readiness?.three_consecutive_filed_working_capital_change_years,
            `${ticker} has three consecutive filed operating working-capital cash-flow adjustments`).toBe(!noParsedHistory && ticker !== 'IVZ');
          expect(payload.model_eligibility.required_input_readiness?.three_consecutive_filed_operating_cashflow_inputs,
            `${ticker} has three consecutive filed operating cash-flow inputs`).toBe(!noParsedHistory && ticker !== 'IVZ');
          expect(payload.model_eligibility.required_input_readiness?.three_consecutive_reconciled_aum_rollforwards,
            `${ticker} has three source-reconciled AUM rollforwards`).toBe(!noParsedHistory && ticker !== 'IVZ');
          expect(payload.model_eligibility.required_input_readiness?.three_consecutive_filed_base_fee_years,
            `${ticker} has three consecutive base-fee years`).toBe(!noParsedHistory && ticker !== 'IVZ');
          expect(payload.model_eligibility.required_input_readiness?.three_consecutive_filed_performance_fee_years,
            `${ticker} has three consecutive performance-fee years`).toBe(!noParsedHistory && ticker !== 'IVZ');
          expect(payload.model_eligibility.required_input_readiness?.source_ready_current_equity_bridge,
            `${ticker} has filed common-equity bridge inputs`).toBe(true);
          expect(payload.model_eligibility.required_input_readiness?.production_calculation_and_workbook_route)
            .toBe(true);
          if (ticker === 'IVZ') {
            const block = payload.model_eligibility.blocked_models.find((item) => item.model === 'asset_manager_aum_dcf');
            expect(block?.reason).toContain('three_consecutive_filed_base_fee_years');
          }
          if (noParsedHistory) {
            const block = payload.model_eligibility.blocked_models.find((item) => item.model === 'asset_manager_aum_dcf');
            expect(block?.reason).toContain('Traditional asset-manager model is blocked');
          }
        } else {
          const block = payload.model_eligibility.blocked_models.find((item) => item.model === 'asset_manager_aum_dcf');
          expect(block?.reason).toMatch(/carried interest.*principal investments.*GP commitments/i);
        }
      }
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('builds a live BLK AUM forecast and source-derived FCFF valuation with editable drivers', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-asset-manager-engine-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });

    try {
      const payload = await new BackendApiClient(await backend.start()).getUnifiedCompany('BLK', 5);
      const history = mapCanonicalAssetManagerFinancialsToHistoricals(payload.canonical_financials);
      const {buildSourcedAssetManagerModelAssumptions} = await import('@/services/valuation/asset-manager-assumption-policy');
      const {calculateAssetManagerValuation} = await import('@/services/valuation/asset-manager-model');
      const assumptions = buildSourcedAssetManagerModelAssumptions(payload, history);
      const results = calculateAssetManagerValuation(history, assumptions);

      expect(results.assetManagerForecasts).toHaveLength(5);
      for (const forecast of results.assetManagerForecasts) {
        expect(forecast.beginningAum + forecast.marketChange + forecast.netFlows
          + forecast.realizations + forecast.acquisitions + forecast.fxChange + forecast.scopeChange)
          .toBeCloseTo(forecast.endingAum, 2);
        expect(forecast.averageAum).toBeCloseTo((forecast.beginningAum + forecast.endingAum) / 2, 2);
        expect(forecast.baseFees).toBeCloseTo(forecast.averageAum * forecast.baseFeeYield, 2);
        expect(forecast.totalRevenue).toBeCloseTo(
          forecast.baseFees + forecast.performanceFees + forecast.capitalAllocationIncome
            + forecast.securitiesLendingRevenue + forecast.technologyRevenue + forecast.distributionRevenue
            + forecast.administrativeOtherRevenue + forecast.otherRevenue + forecast.unmappedRevenue,
          2,
        );
        expect(forecast.ebit).toBeCloseTo(forecast.totalRevenue * forecast.operatingMargin, 2);
        expect(forecast.nopat).toBeCloseTo(forecast.ebit * (1 - forecast.taxRate), 2);
        expect(forecast.fcff).toBeCloseTo(
          forecast.nopat + forecast.depreciation + forecast.acquisitionAmortization
            - forecast.capex - forecast.workingCapitalChange,
          2,
        );
      }
      expect(results.enterpriseValue).toBeGreaterThan(0);
      expect(results.equityValue).toBeGreaterThan(0);
      expect(assumptions.terminalGrowthRate).toBeLessThan(assumptions.wacc);
      expect(results.terminalValue).toBeCloseTo(
        results.terminalFcff * (1 + assumptions.terminalGrowthRate) / (assumptions.wacc - assumptions.terminalGrowthRate),
        2,
      );
      expect(results.equityValue).toBeCloseTo(
        results.enterpriseValue! + assumptions.cash + assumptions.marketableSecurities - assumptions.debt
          - assumptions.nonControllingInterest - assumptions.preferredEquity,
        2,
      );
      expect(results.impliedSharePrice).toBeCloseTo(results.equityValue / assumptions.dilutedShares, 6);

      const higherFlows = calculateAssetManagerValuation(history, {
        ...assumptions,
        netFlowRate: assumptions.netFlowRate + 0.01,
      });
      const higherFeeYield = calculateAssetManagerValuation(history, {
        ...assumptions,
        baseFeeYield: assumptions.baseFeeYield + 0.0001,
      });
      const higherMargin = calculateAssetManagerValuation(history, {
        ...assumptions,
        operatingMargin: assumptions.operatingMargin + 0.01,
      });
      const higherWacc = calculateAssetManagerValuation(history, {
        ...assumptions,
        wacc: assumptions.wacc + 0.01,
      });
      const higherShareCount = calculateAssetManagerValuation(history, {
        ...assumptions,
        dilutedShares: assumptions.dilutedShares * 1.01,
      });
      expect(higherFlows.equityValue).toBeGreaterThan(results.equityValue);
      expect(higherFeeYield.equityValue).toBeGreaterThan(results.equityValue);
      expect(higherMargin.equityValue).toBeGreaterThan(results.equityValue);
      expect(higherWacc.equityValue).toBeLessThan(results.equityValue);
      expect(higherShareCount.impliedSharePrice).toBeLessThan(results.impliedSharePrice);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('builds a live TROW forecast with capital-allocation income and unmapped fee lines shown separately', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-trow-asset-manager-engine-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });

    try {
      const payload = await new BackendApiClient(await backend.start()).getUnifiedCompany('TROW', 5);
      const history = mapCanonicalAssetManagerFinancialsToHistoricals(payload.canonical_financials);
      const {buildSourcedAssetManagerModelAssumptions} = await import('@/services/valuation/asset-manager-assumption-policy');
      const {calculateAssetManagerValuation} = await import('@/services/valuation/asset-manager-model');
      const assumptions = buildSourcedAssetManagerModelAssumptions(payload, history);
      const results = calculateAssetManagerValuation(history, assumptions);

      expect(results.assetManagerForecasts).toHaveLength(5);
      expect(results.assetManagerForecasts[0]?.capitalAllocationIncome).toBeGreaterThan(0);
      expect(results.assetManagerForecasts[0]?.administrativeOtherRevenue).toBeGreaterThan(0);
      expect(results.assetManagerForecasts[0]?.totalRevenue).toBeCloseTo(
        results.assetManagerForecasts[0]!.baseFees + results.assetManagerForecasts[0]!.performanceFees
          + results.assetManagerForecasts[0]!.capitalAllocationIncome + results.assetManagerForecasts[0]!.securitiesLendingRevenue
          + results.assetManagerForecasts[0]!.technologyRevenue + results.assetManagerForecasts[0]!.distributionRevenue
          + results.assetManagerForecasts[0]!.administrativeOtherRevenue + results.assetManagerForecasts[0]!.otherRevenue
          + results.assetManagerForecasts[0]!.unmappedRevenue,
        2,
      );
      expect(assumptions.assumptionSources.technologyRevenueGrowth).toContain('Analyst input');
      expect(results.enterpriseValue).toBeGreaterThan(0);
      expect(results.impliedSharePrice).toBeGreaterThan(0);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('writes live BLK and TROW asset-manager workbooks with editable formulas and SEC source registers', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-asset-manager-workbook-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });

    try {
      const client = new BackendApiClient(await backend.start());
      const {buildSourcedAssetManagerModelAssumptions} = await import('@/services/valuation/asset-manager-assumption-policy');
      const {calculateAssetManagerValuation} = await import('@/services/valuation/asset-manager-model');
      const {buildAssetManagerModelExportPayload} = await import('@/services/exporters/excel/asset-manager-payload');
      const pythonScript = `import json, os, shutil, subprocess, sys
from pathlib import Path
from openpyxl import Workbook, load_workbook
from app.api.contracts import AssetManagerModelExportData
from app.services.excel_export.mappers.asset_manager_model import apply_asset_manager_model

with open(sys.argv[1], encoding='utf-8') as source:
    payload = json.load(source)
AssetManagerModelExportData.model_validate(payload['assetManagerModel'])
workbook_path = Path(sys.argv[2])
workbook = Workbook()
apply_asset_manager_model(workbook, payload)
workbook.save(workbook_path)

variant_specs = {
    'market_return': ('L5', lambda value: value + 0.01),
    'net_flows': ('L6', lambda value: value + 0.01),
    'base_fee_yield': ('L11', lambda value: value + 0.0001),
    'operating_margin': ('L21', lambda value: value + 0.01),
    'higher_wacc': ('L27', lambda value: value + 0.01),
    'terminal_growth': ('L35', lambda value: value + 0.005),
    'higher_debt': ('L41', lambda value: value + 100000000),
    'diluted_shares': ('L37', lambda value: value * 1.01),
}
source_paths = {'base': workbook_path}
for name, (cell, edit) in variant_specs.items():
    variant = load_workbook(workbook_path, data_only=False)
    sheet = variant['Asset Manager Model']
    sheet[cell] = edit(float(sheet[cell].value))
    variant_path = workbook_path.with_name(f'{workbook_path.stem}-{name}.xlsx')
    variant.save(variant_path)
    source_paths[name] = variant_path

restore_book = load_workbook(workbook_path, data_only=False)
restore_sheet = restore_book['Asset Manager Model']
original_flow = float(restore_sheet['L6'].value)
restore_sheet['L6'] = original_flow + 0.01
restore_sheet['L6'] = original_flow
restore_path = workbook_path.with_name(f'{workbook_path.stem}-restored.xlsx')
restore_book.save(restore_path)
source_paths['restored'] = restore_path

recalc_dir = workbook_path.parent / 'recalculated'
profile_dir = workbook_path.parent / 'libreoffice-profile'
recalc_dir.mkdir(parents=True, exist_ok=True)
profile_dir.mkdir(parents=True, exist_ok=True)
command = [
    sys.argv[4], '--headless', f'-env:UserInstallation={profile_dir.as_uri()}',
    '--convert-to', 'xlsx', '--outdir', str(recalc_dir), *[str(path) for path in source_paths.values()],
]
process = subprocess.run(command, capture_output=True, text=True, timeout=120)
if process.returncode != 0:
    raise RuntimeError(process.stderr or process.stdout or 'LibreOffice failed to recalculate the asset-manager workbooks.')

def output_for(name):
    cached = load_workbook(recalc_dir / source_paths[name].name, data_only=True)
    sheet = cached['Asset Manager Model']
    formulas = {
        'aum_rollforward': [sheet[f'{column}14'].value for column in 'EFGHI'],
        'revenue': [sheet[f'{column}30'].value for column in 'EFGHI'],
        'fcff': [sheet[f'{column}47'].value for column in 'EFGHI'],
    }
    errors = [
        cell.coordinate for row in sheet.iter_rows()
        for cell in row if isinstance(cell.value, str) and cell.value.startswith('#')
    ]
    return {
        'enterprise_value': sheet['B56'].value,
        'equity_value': sheet['B62'].value,
        'per_share': sheet['B63'].value,
        'sensitivity': [[sheet[f'{column}{row}'].value for column in 'CDEFG'] for row in range(71, 76)],
        'market_return_assumption': sheet['L5'].value,
        'checks': formulas,
        'formula_errors': errors,
    }

inspection_book = load_workbook(workbook_path, data_only=False)
inspection_sheet = inspection_book['Asset Manager Model']
review = inspection_book['Data Review']
formula_cells = {
    cell.coordinate: cell.value for row in inspection_sheet.iter_rows()
    for cell in row if isinstance(cell.value, str) and cell.value.startswith('=')
}
review_text = ' '.join(str(cell.value) for row in review.iter_rows() for cell in row if cell.value is not None)
print(json.dumps({
    'sheets': inspection_book.sheetnames,
    'aum_rollforward': inspection_sheet['E12'].value,
    'base_fees': inspection_sheet['E18'].value,
    'fcff': inspection_sheet['E44'].value,
    'enterprise_value': inspection_sheet['B56'].value,
    'equity_value': inspection_sheet['B62'].value,
    'per_share': inspection_sheet['B63'].value,
    'market_return_number_format': inspection_sheet['L5'].number_format,
    'input_color': inspection_sheet['L5'].font.color.rgb if inspection_sheet['L5'].font.color else None,
    'formulas': formula_cells,
    'has_sec_accession': sys.argv[3] in review_text,
    'has_ref_error': any('#REF!' in str(formula) for formula in formula_cells.values()),
    'recalculated': {name: output_for(name) for name in source_paths},
}))`;
      for (const [ticker, accession] of [
        ['BLK', '0001193125-26-071966'],
        ['TROW', '0001628280-26-008002'],
      ] as const) {
        const data = await client.getUnifiedCompany(ticker, 5);
        const profile = mapNativeProfile(data.profile, data.financials_native, data.market);
        const history = mapCanonicalAssetManagerFinancialsToHistoricals(data.canonical_financials);
        const assumptions = buildSourcedAssetManagerModelAssumptions(data, history);
        const engineResults = calculateAssetManagerValuation(history, assumptions);
        const exportPayload = buildAssetManagerModelExportPayload(profile, history, assumptions);
        expect(() => parseDcfExportPayload(exportPayload)).not.toThrow();
        const inputPath = join(home, `${ticker.toLowerCase()}-asset-manager-export.json`);
        const workbookPath = join(home, `${ticker.toLowerCase()}-asset-manager-live.xlsx`);
        await writeFile(inputPath, JSON.stringify(exportPayload), 'utf8');
        const inspected = spawnSync(pythonPath, ['-c', pythonScript, inputPath, workbookPath, accession, sofficePath], {
          cwd: resolve(projectRoot, 'backend'),
          encoding: 'utf8',
          env: process.env,
        });
        if (inspected.error) throw inspected.error;
        if (inspected.status !== 0) throw new Error(`${ticker} workbook inspection failed: ${inspected.stderr}`);
        const inspection = JSON.parse(inspected.stdout.trim().split(/\r?\n/).at(-1) ?? '{}') as {
          sheets: string[];
          aum_rollforward: unknown;
          base_fees: unknown;
          fcff: unknown;
          enterprise_value: unknown;
          equity_value: unknown;
          per_share: unknown;
          market_return_number_format: string;
          input_color: string | null;
          formulas: Record<string, string>;
          has_sec_accession: boolean;
          has_ref_error: boolean;
          recalculated: Record<string, {
            enterprise_value: number;
            equity_value: number;
            per_share: number;
            sensitivity: Array<Array<number | null>>;
            market_return_assumption: number;
            checks: Record<string, Array<number | null>>;
            formula_errors: string[];
          }>;
        };
        expect(inspection.sheets, `${ticker} dedicated sheets`).toEqual(['Asset Manager Model', 'Data Review']);
        expect(inspection.aum_rollforward, `${ticker} AUM rollforward`).toBe('=SUM(E5:E11)');
        expect(String(inspection.base_fees), `${ticker} base fees are formula-driven`).toMatch(/^=/);
        expect(String(inspection.fcff), `${ticker} FCFF is formula-driven`).toMatch(/^=/);
        expect(String(inspection.enterprise_value), `${ticker} enterprise value is formula-driven`).toMatch(/^=/);
        expect(String(inspection.equity_value), `${ticker} equity bridge is formula-driven`).toMatch(/^=/);
        expect(inspection.per_share, `${ticker} per-share value is formula-driven`).toMatch(/^=/);
        expect(inspection.input_color, `${ticker} editable assumptions are blue`).toMatch(/0000FF$/);
        expect(inspection.recalculated.base?.market_return_assumption, `${ticker} zero market-return assumption is explicit`)
          .toBe(0);
        expect(inspection.market_return_number_format, `${ticker} zero percentages display as 0.0%`)
          .toMatch(/;0\.0%$/);
        expect(inspection.formulas.E12, `${ticker} AUM rollforward formula`).toBe('=SUM(E5:E11)');
        expect(String(inspection.formulas.E18), `${ticker} base-fee formula`).toMatch(/^=/);
        expect(String(inspection.formulas.E44), `${ticker} FCFF formula`).toMatch(/^=/);
        expect(String(inspection.formulas.B63), `${ticker} per-share bridge formula`).toMatch(/^=/);
        expect(inspection.has_sec_accession, `${ticker} SEC source register`).toBe(true);
        expect(inspection.has_ref_error, `${ticker} no broken references`).toBe(false);
        const base = inspection.recalculated.base!;
        expect(Math.abs(base.equity_value - engineResults.equityValue) / engineResults.equityValue,
          `${ticker} recalculated common-equity parity is within 0.1%`).toBeLessThan(0.001);
        expect(Math.abs(base.per_share - engineResults.impliedSharePrice),
          `${ticker} recalculated per-share parity is within $0.01`).toBeLessThanOrEqual(0.01);
        expect(base.formula_errors, `${ticker} has no recalculated formula errors`).toEqual([]);
        const baseWaccSensitivity = base.sensitivity[2];
        expect(baseWaccSensitivity, `${ticker} base-WACC sensitivity row exists`).toHaveLength(5);
        expect(baseWaccSensitivity?.every((value) => typeof value === 'number'),
          `${ticker} base-WACC sensitivity row recalculates`).toBe(true);
        expect(baseWaccSensitivity?.[0], `${ticker} value increases with terminal growth`).toBeLessThan(baseWaccSensitivity?.[1] ?? 0);
        expect(baseWaccSensitivity?.[1]).toBeLessThan(baseWaccSensitivity?.[2] ?? 0);
        expect(baseWaccSensitivity?.[2]).toBeLessThan(baseWaccSensitivity?.[3] ?? 0);
        expect(baseWaccSensitivity?.[3]).toBeLessThan(baseWaccSensitivity?.[4] ?? 0);
        expect(baseWaccSensitivity?.[2], `${ticker} sensitivity center ties to per-share value`)
          .toBeCloseTo(base.per_share, 2);
        for (const check of Object.values(base.checks)) {
          expect(check.every((value) => typeof value === 'number' && Math.abs(value) < 1),
            `${ticker} forecast checks recalculate to zero`).toBe(true);
        }
        expect(inspection.recalculated.market_return!.equity_value).toBeGreaterThan(base.equity_value);
        expect(inspection.recalculated.net_flows!.equity_value).toBeGreaterThan(base.equity_value);
        expect(inspection.recalculated.base_fee_yield!.equity_value).toBeGreaterThan(base.equity_value);
        expect(inspection.recalculated.operating_margin!.equity_value).toBeGreaterThan(base.equity_value);
        expect(inspection.recalculated.higher_wacc!.equity_value).toBeLessThan(base.equity_value);
        expect(inspection.recalculated.terminal_growth!.equity_value).toBeGreaterThan(base.equity_value);
        expect(inspection.recalculated.higher_debt!.per_share).toBeLessThan(base.per_share);
        expect(inspection.recalculated.diluted_shares!.per_share).toBeLessThan(base.per_share);
        expect(inspection.recalculated.restored!.equity_value).toBeCloseTo(base.equity_value, 2);
        expect(inspection.recalculated.restored!.per_share).toBeCloseTo(base.per_share, 4);
      }
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('exports live BLK and TROW through the dedicated asset-manager CLI route and keeps alternatives blocked', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-asset-manager-cli-'));
    const backendProcess = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });

    try {
      const backend = new BackendApiClient(await backendProcess.start());
      for (const ticker of ['BLK', 'TROW']) {
        const result = await runValuationJob(ticker, backend);
        expect(result.results.isValuationSupported, `${ticker} route is supported`).toBe(true);
        expect(result.exportPayload.valuationModel, `${ticker} selected model`).toBe('asset_manager_aum_dcf');
        expect(result.exportPayload.assetManagerModel?.history.annual).toHaveLength(3);
        expect(result.workbookBytes.byteLength, `${ticker} produced an Excel workbook`).toBeGreaterThan(10_000);
        expect(result.warnings.some((warning) => warning.includes('2026 quarterly AUM and fee changes are not incorporated')),
          `${ticker} discloses the annual actual data boundary`).toBe(true);
      }
      // BX files no parseable alt-manager tables and carries no alternative
      // text marker, so it resolves traditional + blocked-from-ready (not the
      // alternative path); the outcome still blocks any ready valuation.
      const bxPayload = await backend.getUnifiedCompany('BX', 5);
      expect(bxPayload.model_eligibility.status).toBe('input_required');
      expect(bxPayload.model_eligibility.blocked_models.some((item) =>
        item.model === 'asset_manager_aum_dcf'
        && item.reason.includes('Traditional asset-manager model is blocked'))).toBe(true);
      const bxResult = await runValuationJob('BX', backend);
      expect(bxResult.status).toBe('input_required');
    } finally {
      await backendProcess.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('does not assign an unrecognized live telecom issuer the technology-hardware preset', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-unknown-industry-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });

    try {
      const payload = await new BackendApiClient(await backend.start()).getUnifiedCompany('LUMN', 5);
      const profile = mapNativeProfile(payload.profile, payload.financials_native, payload.market);
      const historicals = mapCanonicalFinancialsToHistoricals(payload.canonical_financials, payload.market, profile);
      const marketInputs = {
        rf: payload.valuation_context.risk_free_rate ?? undefined,
        mrp: payload.valuation_context.equity_risk_premium ?? undefined,
      };
      const historicalAssumptions = calculateInitialAssumptions(historicals, marketInputs, {medianEvEbitda: 12});
      expect(detectIndustryTemplate(profile.ticker, profile.sector, profile.industry)).toBeNull();
      expect(buildBaseAssumptions(historicals, marketInputs, 12, profile).revenueGrowth)
        .toBeCloseTo(historicalAssumptions.revenueGrowth, 4);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('initializes live operating growth from filed history instead of a static sector preset', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-history-growth-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });

    try {
      const client = new BackendApiClient(await backend.start());
      const payload = await client.getUnifiedCompany('AAPL', 5);
      const profile = mapNativeProfile(payload.profile, payload.financials_native, payload.market);
      const historicals = mapCanonicalFinancialsToHistoricals(payload.canonical_financials, payload.market, profile);
      const historicalAssumptions = calculateInitialAssumptions(
        historicals,
        {
          riskFreeRate: payload.valuation_context.risk_free_rate ?? undefined,
          equityRiskPremium: payload.valuation_context.equity_risk_premium ?? undefined,
        },
        {medianEvEbitda: 12},
      );
      const result = await runValuationJob('AAPL', client);
      expect(result.exportPayload.assumptions.revenueGrowth)
        .toBeCloseTo(historicalAssumptions.revenueGrowth, 4);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('exports a live operating-model workbook with a blank required input and no valuation', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-incomplete-aapl-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });

    try {
      const client = new BackendApiClient(await backend.start());
      const sourceData = await client.getUnifiedCompany('AAPL', 5);
      const incomplete = structuredClone(sourceData);
      const latest = incomplete.canonical_financials.annual.at(-1);
      if (!latest || typeof latest.capex.value !== 'number') {
        throw new Error('Live AAPL FY2025 CapEx is not source-backed for the redaction test.');
      }
      const originalCapex = latest.capex.value;
      latest.capex = {
        ...latest.capex,
        source: 'missing',
        value: null,
        method: 'redacted_from_live_payload_for_incomplete_model_test',
      };
      incomplete.model_eligibility.status = 'input_required';
      incomplete.model_eligibility.model_route_available = true;
      incomplete.model_eligibility.supported_by_current_engine = false;
      incomplete.model_eligibility.allowed_models = ['unlevered_dcf'];
      incomplete.model_eligibility.required_input_readiness = {
        ...incomplete.model_eligibility.required_input_readiness,
        three_year_operating_driver_history: false,
      };
      incomplete.model_eligibility.missing_input_gaps = [{
        key: 'three_year_operating_driver_history',
        label: 'Three-year filed operating driver history',
        reason: 'FY2025 filed CapEx must be supplied to complete the three-year operating driver history.',
      }];

      const redactedBackend = {
        getUnifiedCompany: async (ticker: string, years: number) => {
          expect(ticker).toBe('AAPL');
          expect(years).toBe(5);
          return incomplete;
        },
        exportDcf: (payload: Parameters<typeof client.exportDcf>[0]) => client.exportDcf(payload),
      };
      const result = await runValuationJob('AAPL', redactedBackend);

      expect(originalCapex).toBeGreaterThan(0);
      if (incomplete.canonical_financials.latest?.preferred_equity.source === 'not_applicable') {
        expect(result.exportPayload.market?.preferredEquity).toBe(0);
      }
      expect(result.status).toBe('input_required');
      expect(result.results).toBeNull();
      expect(result.missingInputs.some((item) => item.key === 'capex' && item.fiscalYear === latest.year)).toBe(true);
      const summary = formatValuationJobSuccess(result, '/tmp/aapl_dcf.xlsx');
      expect(summary).toContain('Status: INCOMPLETE — no valuation was calculated.');
      expect(summary).toContain('FY2025');
      expect(summary).not.toMatch(/implied price|upside/i);
      expect([...result.workbookBytes.subarray(0, 2)]).toEqual([0x50, 0x4b]);
      expect(result.workbookBytes.byteLength).toBeGreaterThan(1_000);
      const workbookPath = join(home, 'redacted_aapl_dcf.xlsx');
      await writeFile(workbookPath, result.workbookBytes);
      const inspection = await inspectIncompleteWorkbook(workbookPath);
      expect(inspection.sheets).toContain('Data Review');
      expect(inspection.status_formula).toContain('INCOMPLETE');
      expect(inspection.status_formula).toContain('READY');
      expect(inspection.status_value).toBe('INCOMPLETE — fill required inputs');
      expect(inspection.formula_errors).toEqual([]);
      expect(inspection.input_value).toBeNull();
      expect(inspection.input_font_rgb?.slice(-6)).toBe('0000FF');
      expect(inspection.input_locked).toBe(false);
      expect(inspection.input_sheet_protected).toBe(false);
      expect(inspection.review_sheet_protected).toBe(false);
      expect(inspection.dcf_sheet_protected).toBe(false);
      expect(JSON.stringify(inspection.review_row)).toContain(`Input Required!${inspection.input_coordinate}`);
      expect(inspection.sheets).toContain('DCF Model - Base (1)');
      expect(inspection.dcf_formula_count).toBeGreaterThan(100);
      expect(String(inspection.forecast_formula)).toContain("'Input Required'!$B$3");
      expect(inspection.forecast_value === null || inspection.forecast_value === '').toBe(true);
      expect(inspection.valuation_values?.every((value) => value === null || value === '')).toBe(true);

      const completeBackend = {
        getUnifiedCompany: async (ticker: string, years: number) => {
          expect(ticker).toBe('AAPL');
          expect(years).toBe(5);
          return sourceData;
        },
        exportDcf: (payload: Parameters<typeof client.exportDcf>[0]) => client.exportDcf(payload),
      };
      const complete = await runValuationJob('AAPL', completeBackend);
      if (complete.status !== 'ready') throw new Error('Live AAPL complete model did not reach ready status.');
      const completeCapex = complete.exportPayload.historicals.cashflow.Capex?.at(-1);
      if (typeof completeCapex !== 'number' || !Number.isFinite(completeCapex)) {
        throw new Error('Live AAPL export has no FY2025 CapEx amount to restore.');
      }
      const capexSource = sourceData.canonical_financials.latest?.capex.sources[0];
      if (!capexSource?.accession || !capexSource.filed) {
        throw new Error('Live AAPL CapEx has no accession and filing date for source entry.');
      }
      const sourceReference = `SEC accession ${capexSource.accession}, filed ${capexSource.filed}`;
      const capexInMillions = completeCapex / 1_000_000;
      const completeWorkbookPath = join(home, 'ready_aapl_dcf.xlsx');
      await writeFile(completeWorkbookPath, complete.workbookBytes);
      const restored = await inspectIncompleteWorkbook(workbookPath, capexInMillions, sourceReference, completeWorkbookPath);
      expect(restored.status_value).toBe('READY');
      expect(restored.formula_errors).toEqual([]);
      expect(typeof restored.forecast_value).toBe('number');
      const usesGrowthTerminal = complete.exportPayload.assumptions.terminal.method === 'Perpetuity';
      const restoredEquity = restored.valuation_values?.[usesGrowthTerminal ? 7 : 4];
      const restoredPerShare = restored.valuation_values?.[usesGrowthTerminal ? 9 : 6];
      const readyWorkbookEquity = usesGrowthTerminal ? restored.complete_values?.[2] : restored.complete_values?.[0];
      const readyWorkbookPerShare = usesGrowthTerminal ? restored.complete_values?.[3] : restored.complete_values?.[1];
      expect(typeof restoredEquity).toBe('number');
      expect(typeof restoredPerShare).toBe('number');
      expect(typeof readyWorkbookEquity).toBe('number');
      expect(typeof readyWorkbookPerShare).toBe('number');
      const equityParityError = Math.abs(Number(restoredEquity) * 1_000_000 - complete.results.equityValue) / complete.results.equityValue;
      expect(equityParityError, JSON.stringify({
        restoredEquityMillions: restoredEquity,
        engineEquityValue: complete.results.equityValue,
        restoredPerShare,
        enginePerShare: complete.results.impliedSharePrice,
        capexInMillions,
        wacc: complete.exportPayload.assumptions.waccRate,
        revenueGrowth: complete.exportPayload.assumptions.revenueGrowthStage1,
      }))
        .toBeLessThan(0.001);
      expect(Math.abs(Number(restoredPerShare) - complete.results.impliedSharePrice)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(Number(restoredEquity) - Number(readyWorkbookEquity)) / Number(readyWorkbookEquity)).toBeLessThan(0.001);
      expect(Math.abs(Number(restoredPerShare) - Number(readyWorkbookPerShare))).toBeLessThanOrEqual(0.01);

      const invalidCapex = await inspectIncompleteWorkbook(workbookPath, -1, sourceReference);
      expect(invalidCapex.status_value).toBe('INPUT ERROR — check required inputs');
      expect(invalidCapex.formula_errors).toEqual([]);
      expect(invalidCapex.forecast_value === null || invalidCapex.forecast_value === '').toBe(true);
      expect(invalidCapex.valuation_values?.every((value) => value === null || value === '')).toBe(true);

      const missingSource = await inspectIncompleteWorkbook(workbookPath, capexInMillions);
      expect(missingSource.status_value).toBe('INCOMPLETE — fill required inputs');
      expect(missingSource.valuation_values?.every((value) => value === null || value === '')).toBe(true);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('exports a live incomplete commercial-bank workbook when the filed CET1 floor is missing', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-incomplete-jpm-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });

    try {
      const client = new BackendApiClient(await backend.start());
      const completeData = await client.getUnifiedCompany('JPM', 5);
      const incomplete = structuredClone(completeData);
      const latest = incomplete.canonical_financials.annual.at(-1);
      const cet1Floor = latest?.bank?.minimum_cet1_ratio;
      if (!latest?.bank || typeof cet1Floor?.value !== 'number') {
        throw new Error('Live JPM latest minimum CET1 ratio is not source-backed for the redaction test.');
      }
      const minimumCet1Source = cet1Floor.sources[0];
      if (!minimumCet1Source?.accession || !minimumCet1Source.filed) {
        throw new Error('Live JPM minimum CET1 source metadata is incomplete for workbook restoration.');
      }
      const redacted = {
        ...cet1Floor,
        source: 'missing' as const,
        value: null,
        method: 'redacted_from_live_payload_for_incomplete_bank_test',
      };
      latest.bank.minimum_cet1_ratio = redacted;
      if (incomplete.canonical_financials.latest?.bank) {
        incomplete.canonical_financials.latest.bank.minimum_cet1_ratio = redacted;
      }
      incomplete.model_eligibility.status = 'input_required';
      incomplete.model_eligibility.model_route_available = true;
      incomplete.model_eligibility.supported_by_current_engine = false;
      incomplete.model_eligibility.allowed_models = ['bank_residual_income'];
      incomplete.model_eligibility.required_input_readiness = {
        ...incomplete.model_eligibility.required_input_readiness,
        minimum_cet1_ratio: false,
      };
      incomplete.model_eligibility.missing_input_gaps = [{
        key: 'minimum_cet1_ratio',
        label: 'Minimum CET1 ratio',
        reason: 'The latest filed bank capital floor must be provided before a valuation can be calculated.',
      }];

      const redactedBackend = {
        getUnifiedCompany: async (ticker: string, years: number) => {
          expect(ticker).toBe('JPM');
          expect(years).toBe(5);
          return incomplete;
        },
        exportDcf: (payload: Parameters<typeof client.exportDcf>[0]) => client.exportDcf(payload),
      };
      const result = await runValuationJob('JPM', redactedBackend);
      expect(result.status).toBe('input_required');
      expect(result.results).toBeNull();
      expect(result.missingInputs.some((input) => input.key === 'minimum_cet1_ratio'
        && input.fiscalYear === latest.year && input.unit === 'ratio')).toBe(true);

      const workbookPath = join(home, 'incomplete_jpm_dcf.xlsx');
      await writeFile(workbookPath, result.workbookBytes);
      const completeResult = await runValuationJob('JPM', {
        getUnifiedCompany: async () => completeData,
        exportDcf: (payload) => client.exportDcf(payload),
      });
      expect(completeResult.status).toBe('ready');
      const completeWorkbookPath = join(home, 'complete_jpm_bank_model.xlsx');
      await writeFile(completeWorkbookPath, completeResult.workbookBytes);
      const sourceReference = `${minimumCet1Source.concept ?? 'SEC filing'} accession ${minimumCet1Source.accession} filed ${minimumCet1Source.filed}`;
      const inspection = await inspectIncompleteBankWorkbook(
        workbookPath,
        cet1Floor.value,
        sourceReference,
        completeWorkbookPath,
      );
      expect(inspection.sheets).toContain('Bank Model');
      expect(inspection.required_input_row).toBeGreaterThan(0);
      expect(inspection.input_value).toBeNull();
      expect(inspection.input_font_rgb?.slice(-6)).toBe('0000FF');
      expect(inspection.input_locked).toBe(false);
      expect(inspection.source_required).toBe('Yes');
      expect(String(inspection.status_value)).toContain('INCOMPLETE');
      expect(inspection.minimum_cet1_input === null || inspection.minimum_cet1_input === '').toBe(true);
      expect(String(inspection.minimum_cet1_formula)).toContain('Input Required');
      expect(inspection.equity_value === null || inspection.equity_value === '').toBe(true);
      expect(inspection.per_share === null || inspection.per_share === '').toBe(true);
      expect(inspection.data_review_row).toBeGreaterThan(0);
      expect(inspection.data_review_values?.[7]).toContain(`Input Required!F${inspection.required_input_row}`);
      expect(inspection.data_review_values?.[4]).toBe(`FY${latest.year}`);
      expect(inspection.data_review_values?.[5]).toBe('ratio');
      expect(String(inspection.data_review_values?.[8])).toContain(`'Input Required'!G${inspection.required_input_row}`);
      expect(inspection.data_review_status).toBe('INPUT REQUIRED');
      expect(inspection.guarded_formulas?.C63).toContain('Input Required');
      expect(inspection.guarded_formulas?.C63).toContain('$B$33');
      expect(inspection.guarded_formulas?.C71).toContain('Input Required');
      expect(inspection.guarded_formulas?.B77).toContain('Input Required');
      expect(inspection.guarded_formulas?.B77).toContain('$B$74');
      expect(inspection.guarded_formulas?.B77).toContain('$B$76');
      for (const value of Object.values(inspection.guarded_values ?? {})) {
        expect(value === null || value === '').toBe(true);
      }
      expect(inspection.restored_status).toBe('READY');
      expect(inspection.restored_source_reference).toBe(sourceReference);
      expect(inspection.restored_equity_value).toEqual(expect.any(Number));
      expect(inspection.complete_equity_value).toEqual(expect.any(Number));
      expect(inspection.restored_per_share).toEqual(expect.any(Number));
      expect(inspection.complete_per_share).toEqual(expect.any(Number));
      expect(Math.abs(inspection.restored_equity_value! - inspection.complete_equity_value!)
        / Math.abs(inspection.complete_equity_value!)).toBeLessThanOrEqual(0.001);
      expect(Math.abs(inspection.restored_per_share! - inspection.complete_per_share!)).toBeLessThanOrEqual(0.01);
      expect(inspection.formula_errors).toEqual([]);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('maps live MRNA pipeline assets and source references from the latest 10-K', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-biotech-pipeline-map-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {...process.env, HOME: home, DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite')},
    });

    try {
      const payload = await new BackendApiClient(await backend.start()).getUnifiedCompany('MRNA', 5);
      const financials = payload.financials_native as unknown as Record<string, unknown>;
      const assets = financials.pipeline_assets as Array<Record<string, unknown>> | undefined;
      expect(Array.isArray(assets)).toBe(true);
      expect(assets?.length).toBeGreaterThanOrEqual(5);
      const assetIds = new Set(assets?.map((asset) => asset.asset_id));
      for (const assetId of ['mRNA-1010', 'mRNA-1083', 'mRNA-1403', 'mRNA-3927', 'mRNA-4157']) {
        expect(assetIds, `MRNA filing includes ${assetId}`).toContain(assetId);
      }
      expect(new Set(assets?.map((asset) => asset.asset_id)).size).toBe(assets?.length);
      expect(assets?.every((asset) => asset.accession_number && asset.filing_date && asset.form === '10-K'
        && typeof asset.source_statement === 'string' && String(asset.source_statement).includes('Item 1'))).toBe(true);
      const assetsById = new Map(assets?.map((asset) => [asset.asset_id, asset]));
      expect(assetsById.get('mRNA-4157')?.partner).toBe('Merck');
      expect(assetsById.get('mRNA-3927')?.partner).toBe('Recordati');
      expect(assetsById.get('mRNA-4359')?.partner).not.toBe('Merck');
      expect(assetsById.get('mRNA-1011')?.development_status).toBe('explicitly_paused');
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('maps live MET and PRU adjusted earnings and statutory-capital facts with issuer-specific basis', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-life-insurance-facts-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {...process.env, HOME: home, DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite')},
    });

    try {
      const client = new BackendApiClient(await backend.start());
      const met = await client.getUnifiedCompany('MET', 5);
      const pru = await client.getUnifiedCompany('PRU', 5);
      const metFacts = (met.financials_native as Record<string, unknown>).life_insurance_filing_facts as Array<Record<string, unknown>> | undefined;
      const pruFacts = (pru.financials_native as Record<string, unknown>).life_insurance_filing_facts as Array<Record<string, unknown>> | undefined;
      expect(Array.isArray(metFacts)).toBe(true);
      expect(Array.isArray(pruFacts)).toBe(true);
      const met2025 = metFacts?.filter((fact) => fact.metric === 'adjusted_earnings_available_to_common' && fact.fiscal_year === 2025) ?? [];
      const pru2025 = pruFacts?.filter((fact) => fact.metric === 'adjusted_operating_income_pretax' && fact.fiscal_year === 2025) ?? [];
      expect(met2025.map((fact) => fact.segment)).toEqual(expect.arrayContaining([
        'Group Benefits', 'RIS', 'Asia', 'Latin America', 'EMEA', 'MIM', 'Corporate & Other',
      ]));
      expect(met2025.reduce((sum, fact) => sum + Number(fact.value), 0)).toBeCloseTo(5_943, 3);
      expect(pru2025.map((fact) => fact.segment)).toEqual(expect.arrayContaining([
        'PGIM', 'Retirement Strategies', 'Group Insurance', 'Individual Life', 'International Businesses', 'Corporate and Other',
      ]));
      expect(pru2025.reduce((sum, fact) => sum + Number(fact.value), 0)).toBeCloseTo(6_637, 3);
      expect(met2025.every((fact) => fact.earnings_basis === 'after_tax_adjusted_earnings_available_to_common'
        && fact.accession_number === '0001099219-26-000013' && fact.filing_date === '2026-02-19'
        && fact.report_date === '2025-12-31' && fact.source_statement)).toBe(true);
      expect(pru2025.every((fact) => fact.earnings_basis === 'pre_tax_adjusted_operating_income'
        && fact.accession_number === '0001137774-26-000048' && fact.filing_date === '2026-02-12'
        && fact.report_date === '2025-12-31' && fact.source_statement)).toBe(true);
      expect(metFacts?.some((fact) => fact.metric === 'statement_based_combined_rbc_ratio_floor'
        && fact.value === 3.5 && fact.comparison_operator === 'greater_than' && String(fact.source_statement).includes('350%'))).toBe(true);
      expect(metFacts?.some((fact) => fact.metric === 'permitted_ordinary_dividend_without_approval'
        && fact.capital_group === 'Metropolitan Life Insurance Company' && fact.fiscal_year === 2026 && fact.value === 2_121)).toBe(true);
      expect(pruFacts?.some((fact) => fact.metric === 'statutory_capital_and_surplus'
        && fact.capital_group === 'PICA' && fact.fiscal_year === 2025 && fact.value === 15_907)).toBe(true);
      expect(pruFacts?.some((fact) => fact.metric === 'permitted_ordinary_dividend_without_approval'
        && String(fact.capital_group).includes('PICA') && fact.fiscal_year === 2026 && fact.value === 1_848)).toBe(true);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('routes source-mapped MET and PRU to input-required life DCF while leaving other life insurers blocked', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-life-insurer-route-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {...process.env, HOME: home, DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite')},
    });

    try {
      const client = new BackendApiClient(await backend.start());
      for (const ticker of ['MET', 'PRU']) {
        const data = await client.getUnifiedCompany(ticker, 5);
        expect(data.model_eligibility.subtype).toBe('life_insurer');
        expect(data.model_eligibility.status).toBe('input_required');
        expect(data.model_eligibility.supported_by_current_engine).toBe(false);
        expect(data.model_eligibility.model_route_available).toBe(true);
        expect(data.model_eligibility.preferred_model).toBe('life_insurer_distributable_earnings_dcf');
        expect(data.model_eligibility.allowed_models).toEqual(['life_insurer_distributable_earnings_dcf']);
      }
      const lnc = await client.getUnifiedCompany('LNC', 5);
      expect(lnc.model_eligibility.subtype).toBe('life_insurer');
      expect((lnc.financials_native as Record<string, unknown>).life_insurance_filing_facts).toEqual([]);
      expect(lnc.model_eligibility.status).toBe('unsupported');
      expect(lnc.model_eligibility.model_route_available).toBe(false);
      expect(lnc.model_eligibility.allowed_models).toEqual([]);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('builds a blank-input life DCF payload for MET and PRU without calculating valuation', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-life-incomplete-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {...process.env, HOME: home, DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite')},
    });

    try {
      const client = new BackendApiClient(await backend.start());
      for (const ticker of ['MET', 'PRU']) {
        const result = await runValuationJob(ticker, client);
        expect(result.status).toBe('input_required');
        if (result.status !== 'input_required') throw new Error(`${ticker} did not return an input-required life DCF.`);
        expect(result.results).toBeNull();
        expect(result.missingInputs.some((input) => input.key === 'life_net_capital_addition')).toBe(true);
        expect(result.missingInputs.some((input) => input.key === 'life_permitted_upstream_dividends')).toBe(true);
        if (ticker === 'PRU') expect(result.missingInputs.some((input) => input.key === 'life_normalized_tax_rate')).toBe(true);
        const lifeModel = (result.exportPayload as unknown as Record<string, unknown>).lifeInsuranceModel as Record<string, unknown> | undefined;
        expect(lifeModel?.ticker).toBe(ticker);
        expect(lifeModel?.filingFacts).toEqual(expect.any(Array));
        const parsedPayload = parseDcfExportPayload(result.exportPayload);
        expect(parsedPayload.buildStatus).toBe('input_required');
        if (parsedPayload.buildStatus !== 'input_required') throw new Error(`${ticker} parsed as a ready life-insurance DCF.`);
        const parsedLifeModel = parsedPayload.lifeInsuranceModel;
        expect(parsedLifeModel?.ticker).toBe(ticker);
        if (!parsedLifeModel) throw new Error(`${ticker} export payload has no validated life-insurance model.`);
        const workbookPath = join(home, `${ticker.toLowerCase()}_life_insurance.xlsx`);
        await writeFile(workbookPath, result.workbookBytes);
        const workbookMarketInputs = {
          risk_free_rate: parsedLifeModel.riskFreeRate ?? 0.04,
          equity_risk_premium: parsedLifeModel.equityRiskPremium ?? 0.05,
          beta: parsedLifeModel.beta ?? 1,
          current_price: parsedLifeModel.currentPrice ?? 60,
          diluted_shares: parsedLifeModel.dilutedShares ?? 1_000_000_000,
        };
        const inspection = await inspectIncompleteLifeInsuranceWorkbook(workbookPath, {
          ticker: ticker as 'MET' | 'PRU',
          ...workbookMarketInputs,
        });
        expect(inspection.sheets).toEqual(['Life Insurance Model', 'Input Required', 'Data Review']);
        expect(inspection.formula_count).toBeGreaterThan(50);
        expect(inspection.model_labels).toContain('Distributable earnings');
        expect(inspection.model_labels).toContain(ticker === 'MET'
          ? 'Adjusted earnings available to common (after tax)'
          : 'Adjusted operating income after tax (normalized tax input)');
        if (ticker === 'PRU') {
          expect(inspection.model_labels.some((label) => label.startsWith(
            'After-tax values are derived with the normalized tax assumption, not reported by the issuer',
          ))).toBe(true);
        }
        expect(inspection.model_formulas.some((formula) => formula.includes('MIN('))).toBe(true);
        expect(inspection.model_formulas.some((formula) => formula.includes("'Input Required'!$B$3") && formula.includes('*(1+'))).toBe(true);
        expect(inspection.input_count).toBeGreaterThan(20);
        expect(inspection.first_input_blank).toBe(true);
        expect(inspection.first_input_blue?.slice(-6)).toBe('0000FF');
        expect(inspection.first_input_locked).toBe(false);
        expect(inspection.source_accessions.some((accession) => accession.includes(ticker === 'MET' ? '1099219' : '1137774'))).toBe(true);
        expect(inspection.source_unit_scale_values).toContain('millions');
        expect(inspection.review_freeze_panes).toBe('A5');
        expect(inspection.blank_status).toContain('INCOMPLETE');
        expect(inspection.blank_model_status).toContain('INCOMPLETE');
        expect(inspection.blank_outputs.every((value) => value === null || value === ''), JSON.stringify({
          outputs: inspection.blank_outputs,
          centerFormula: inspection.blank_center_formula,
          waccHeaderFormula: inspection.blank_cost_of_equity_header_formula,
          growthHeaderFormula: inspection.blank_terminal_growth_header_formula,
          errors: inspection.blank_formula_errors,
        })).toBe(true);
        expect(inspection.invalid_status).toContain('INPUT ERROR');
        expect(inspection.invalid_outputs.every((value) => value === null || value === '')).toBe(true);
        expect(inspection.restored_status).toBe('READY');
        expect(inspection.restored_review_ready).toBe(true);
        expect(inspection.restored_equity_value_millions).toBeGreaterThan(0);
        expect(inspection.restored_per_share).toBeGreaterThan(0);
        expect(inspection.sensitivity_center).toBeCloseTo(inspection.restored_per_share ?? 0, 2);
        expect(inspection.higher_retention_per_share).toBeLessThan(inspection.restored_per_share ?? 0);
        expect(inspection.lower_upstream_per_share).toBeLessThan(inspection.restored_per_share ?? 0);
        expect(inspection.capital_release_per_share).toBeGreaterThan(inspection.restored_per_share ?? 0);
        expect(inspection.cash_below_reserve_input_status).toBe('READY');
        expect(inspection.cash_below_reserve_model_status).toContain('INPUT ERROR');
        expect(inspection.cash_below_reserve_outputs.every((value) => value === null || value === '')).toBe(true);
        expect(inspection.negative_cash_input_status).toBe('READY');
        expect(inspection.negative_cash_model_status).toContain('INPUT ERROR');
        expect(inspection.negative_cash_terminal_distributable).toBeLessThan(0);
        expect(inspection.negative_cash_outputs.every((value) => value === null || value === '')).toBe(true);
        expect(inspection.formula_edited_per_share, JSON.stringify({
          ticker,
          restored: inspection.restored_per_share,
          edited: inspection.formula_edited_per_share,
          restoredForecast: inspection.restored_test_segment_forecast,
          editedForecast: inspection.edited_test_segment_forecast,
          restoredFormula: inspection.restored_test_segment_formula,
          editedFormula: inspection.edited_test_segment_formula,
        })).toBeGreaterThan(inspection.restored_per_share ?? 0);
        expect(inspection.required_source_count).toBeGreaterThan(0);
        expect(inspection.formula_errors).toEqual([]);

        const metric = ticker === 'MET' ? 'adjusted_earnings_available_to_common' : 'adjusted_operating_income_pretax';
        const engineSegments = parsedLifeModel.filingFacts
          .filter((fact) => fact.metric === metric && fact.fiscal_year === parsedLifeModel.baseYear)
          .map((fact) => ({
            segment: String(fact.segment),
            baseEarnings: fact.value * 1_000_000,
            annualGrowth: Array.from({length: 5}, () => 0.04),
          }));
        const {calculateLifeInsuranceDistributableEarnings} = await import('@/services/valuation/life-insurance-model');
        const engine = calculateLifeInsuranceDistributableEarnings({
          ticker: ticker as 'MET' | 'PRU',
          baseYear: parsedLifeModel.baseYear,
          forecastYears: 5,
          earningsBasis: parsedLifeModel.earningsBasis,
          segments: engineSegments,
          ...(ticker === 'PRU' ? {normalizedTaxRate: 0.25} : {}),
          capitalSchedule: {
            netCapitalAdditions: Array.from({length: 5}, () => 500_000_000),
            permittedUpstreamDividends: Array.from({length: 5}, () => 8_000_000_000),
          },
          riskFreeRate: workbookMarketInputs.risk_free_rate,
          equityRiskPremium: workbookMarketInputs.equity_risk_premium,
          beta: workbookMarketInputs.beta,
          terminalGrowthRate: 0.02,
          marketDataAsOfDate: parsedLifeModel.asOfDate,
          currentPrice: workbookMarketInputs.current_price,
          dilutedSharesOutstanding: workbookMarketInputs.diluted_shares,
          parentCash: 3_000_000_000,
          parentCashReserve: 2_000_000_000,
          parentDebt: 500_000_000,
          preferredEquity: 0,
          nonControllingInterest: 0,
        });
        expect(Math.abs((inspection.restored_equity_value_millions ?? 0) * 1_000_000 - engine.equityValue)
          / engine.equityValue).toBeLessThanOrEqual(0.001);
        expect(Math.abs((inspection.restored_per_share ?? 0) - engine.impliedSharePrice)).toBeLessThanOrEqual(0.01);
      }

    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('calculates MET and PRU distributable-earnings DCFs from their distinct live filing bases', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-life-engine-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {...process.env, HOME: home, DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite')},
    });

    try {
      const client = new BackendApiClient(await backend.start());
      const {calculateLifeInsuranceDistributableEarnings} = await import('@/services/valuation/life-insurance-model');
      for (const ticker of ['MET', 'PRU']) {
        const data = await client.getUnifiedCompany(ticker, 5);
        const facts = (data.financials_native as Record<string, unknown>).life_insurance_filing_facts as Array<Record<string, unknown>>;
        const earningsBasis = ticker === 'MET'
          ? 'after_tax_adjusted_earnings_available_to_common'
          : 'pre_tax_adjusted_operating_income';
        const metric = ticker === 'MET' ? 'adjusted_earnings_available_to_common' : 'adjusted_operating_income_pretax';
        const actualSegments = facts.filter((fact) => fact.metric === metric && fact.fiscal_year === 2025);
        const currentPrice = data.market.current_price;
        const dilutedShares = data.canonical_financials.latest?.shares.value;
        const riskFreeRate = data.valuation_context.risk_free_rate;
        const equityRiskPremium = data.valuation_context.equity_risk_premium;
        const beta = data.market.beta;
        if ([currentPrice, dilutedShares, riskFreeRate, equityRiskPremium, beta].some((value) => typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) {
          throw new Error(`Live ${ticker} market inputs are not usable for a DCF engine check.`);
        }
        const testGrowth = 0.04;
        const capitalAdditions = Array.from({length: 5}, () => 500_000_000);
        const upstreamCapacity = Array.from({length: 5}, () => 8_000_000_000);
        const scenarioTaxRate = ticker === 'MET' ? undefined : 0.25;
        const assumptions = {
          ticker: ticker as 'MET' | 'PRU',
          baseYear: 2025,
          forecastYears: 5,
          earningsBasis,
          segments: actualSegments.map((fact) => ({
            segment: String(fact.segment),
            baseEarnings: Number(fact.value) * 1_000_000,
            annualGrowth: Array.from({length: 5}, () => testGrowth),
          })),
          ...(scenarioTaxRate !== undefined ? {normalizedTaxRate: scenarioTaxRate} : {}),
          capitalSchedule: {
            netCapitalAdditions: capitalAdditions,
            permittedUpstreamDividends: upstreamCapacity,
          },
          riskFreeRate,
          equityRiskPremium,
          beta,
          terminalGrowthRate: 0.02,
          marketDataAsOfDate: data.valuation_context.as_of_date,
          currentPrice,
          dilutedSharesOutstanding: dilutedShares,
          parentCash: 3_000_000_000,
          parentCashReserve: 2_000_000_000,
          parentDebt: 500_000_000,
          preferredEquity: 0,
          nonControllingInterest: 0,
        };
        const result = calculateLifeInsuranceDistributableEarnings(assumptions);
        const rawEarnings = actualSegments.reduce((sum, fact) => sum + Number(fact.value) * 1_000_000, 0);
        const afterTaxEarnings = rawEarnings * (1 + testGrowth) * (ticker === 'MET' ? 1 : 1 - scenarioTaxRate!);
        const expectedFirstFlow = Math.min(afterTaxEarnings - capitalAdditions[0]!, upstreamCapacity[0]!);
        expect(result.lifeInsuranceForecasts).toHaveLength(5);
        expect(result.lifeInsuranceForecasts[0]!.distributableEarnings).toBeCloseTo(expectedFirstFlow, 0);
        expect(result.enterpriseValue).toBeNull();
        expect(result.equityValue).toBeGreaterThan(0);
        expect(result.impliedSharePrice).toBeGreaterThan(0);

        const capitalRelease = calculateLifeInsuranceDistributableEarnings({
          ...assumptions,
          capitalSchedule: {
            netCapitalAdditions: Array.from({length: 5}, () => -500_000_000),
            permittedUpstreamDividends: upstreamCapacity,
          },
        });
        expect(capitalRelease.lifeInsuranceForecasts[0]!.distributableEarnings)
          .toBeGreaterThan(result.lifeInsuranceForecasts[0]!.distributableEarnings);

        const limitedDistribution = calculateLifeInsuranceDistributableEarnings({
          ...assumptions,
          capitalSchedule: {
            netCapitalAdditions: capitalAdditions,
            permittedUpstreamDividends: Array.from({length: 5}, () => 1_000_000_000),
          },
        });
        expect(limitedDistribution.lifeInsuranceForecasts[0]!.distributableEarnings).toBe(1_000_000_000);

        expect(() => calculateLifeInsuranceDistributableEarnings({
          ...assumptions,
          capitalSchedule: {
            netCapitalAdditions: Array.from({length: 5}, () => 8_000_000_000),
            permittedUpstreamDividends: upstreamCapacity,
          },
        })).toThrow('positive terminal distributable earnings');
        expect(() => calculateLifeInsuranceDistributableEarnings({...assumptions, parentCash: 1_000_000_000}))
          .toThrow('parent cash must meet or exceed its reserve');
        expect(() => calculateLifeInsuranceDistributableEarnings({...assumptions, terminalGrowthRate: result.costOfEquity}))
          .toThrow('terminal growth');
        if (ticker === 'MET') {
          expect(() => calculateLifeInsuranceDistributableEarnings({...assumptions, normalizedTaxRate: 0.25}))
            .toThrow('must not be taxed again');
        } else {
          expect(() => calculateLifeInsuranceDistributableEarnings({...assumptions, normalizedTaxRate: undefined}))
            .toThrow('requires a normalized tax-rate input');
        }
      }
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('exports live MET and PRU life-insurance workbooks through the DCF Builder CLI', async () => {
    assertEdgarIdentityConfigured();
    for (const ticker of ['MET', 'PRU'] as const) {
      const home = await mkdtemp(join(tmpdir(), `dcfbuild-live-life-cli-${ticker.toLowerCase()}-`));
      const outputPath = join(home, `${ticker.toLowerCase()}_dcf.xlsx`);
      try {
        const result = runLiveCli(ticker, outputPath, home);
        if (result.error) throw new Error(`Live dcfbuild failed (${result.error.name}).`);
        const output = sanitizedOutput(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
        expect(result.status, output).toBe(0);
        expect(output).toContain(`Workbook: ${outputPath}`);
        expect(output).toContain('Status: INCOMPLETE — no valuation was calculated.');
        expect(output).toContain(ticker);
        expect(output).not.toMatch(/implied price|upside/i);
        const workbookBytes = await readFile(outputPath);
        expect([...workbookBytes.subarray(0, 2)]).toEqual([0x50, 0x4b]);
        const inspection = await inspectIncompleteLifeInsuranceWorkbook(outputPath, {
          ticker,
          risk_free_rate: 0.04,
          equity_risk_premium: 0.05,
          beta: 1,
          current_price: 60,
          diluted_shares: 1_000_000_000,
        });
        expect(inspection.sheets).toEqual(['Life Insurance Model', 'Input Required', 'Data Review']);
        expect(inspection.blank_model_status).toContain('INCOMPLETE');
        expect(inspection.blank_outputs.every((value) => value === null || value === '')).toBe(true);
        expect(inspection.missing_source_status).toContain('INCOMPLETE');
        expect(inspection.missing_source_review_failed).toBe(true);
        expect(inspection.missing_source_outputs.every((value) => value === null || value === '')).toBe(true);
        expect(inspection.formula_errors).toEqual([]);
      } finally {
        await rm(home, {recursive: true, force: true});
      }
    }
  }, 300_000);

  it('exports an input-required pipeline rNPV workbook for live MRNA', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-mrna-'));
    const outputPath = join(home, 'mrna_dcf.xlsx');

    try {
      const result = runLiveCli('MRNA', outputPath, home);
      if (result.error) throw new Error(`Live dcfbuild failed (${result.error.name}).`);
      const output = sanitizedOutput(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
      expect(result.status, output).toBe(0);
      expect(output).toContain(`Workbook: ${outputPath}`);
      expect(output).toContain('Status: INCOMPLETE — no valuation was calculated.');
      expect(output).toContain('mRNA-4157 probability of success');
      expect(output).toContain('Pipeline rNPV outside the SEC-mapped asset inventory');
      expect(output).not.toMatch(/implied price|upside/i);
      const workbook = await readFile(outputPath);
      expect([...workbook.subarray(0, 2)]).toEqual([0x50, 0x4b]);
      const inspection = inspectBiotechPipelineScope(outputPath);
      expect(inspection.pipelineAssetIds).toContain('mRNA-1011');
      expect(inspection.inputKeys).toContain('asset_scope_include:mRNA-1011');
      expect(inspection.inputKeys).toContain('asset_scope_rnpv:mRNA-1011');
      expect(inspection.programFacts['mRNA-4157']?.reportedFacts).toContain('Partner: Merck');
      expect(inspection.programFacts['mRNA-4157']?.sourceBasis).toContain('Item 1');
      expect(inspection.programFacts['mRNA-1011']?.reportedFacts).toContain('explicitly_paused');
      expect(inspection.discountFactorLabel).toContain('Discount factor');
      expect(inspection.aggregatePipelineCashflowLabel).toContain('Risk-adjusted asset FCFF');
      const model = inspectIncompleteBiotechWorkbook(outputPath);
      expect(model.sheets).toEqual(['Biotech Model', 'Pipeline Valuation', 'Input Required', 'Data Review']);
      expect(model.formulaCount).toBeGreaterThan(400);
      expect(model.modelProtected).toBe(false);
      expect(model.inputProtected).toBe(false);
      expect(model.firstInputBlank).toBe(true);
      expect(model.firstInputBlue?.slice(-6)).toBe('0000FF');
      expect(model.firstInputLocked).toBe(false);
      expect(model.amountMultiplier).toBe(1_000_000);
      expect(model.blankStatus).toBe('INCOMPLETE — fill required inputs');
      expect(model.blankModelStatus).toContain('INCOMPLETE');
      expect(model.blankOutputs.every((value) => value === null || value === '')).toBe(true);
      expect(model.invalidStatus).toBe('INPUT ERROR — check required inputs');
      expect(model.invalidIncludeReviewStatus).toBe('INPUT ERROR');
      expect(model.invalidOutputs.every((value) => value === null || value === '')).toBe(true);
      expect(model.restoredStatus).toBe('READY');
      expect(model.restoredReviewStatus).toBe(true);
      expect(model.excludedDetailedRnpv).toBeCloseTo(0, 6);
      expect(model.includedOtherAssetRnpv).toBeGreaterThan(0);
      expect(model.excludedOtherAssetRnpv).toBeCloseTo(0, 6);
      expect(model.sensitivityCenter).toBeCloseTo(model.restoredPerShare ?? 0, 2);
      expect(model.sensitivityLowerWacc).toBeGreaterThan(model.sensitivityCenter ?? 0);
      expect(model.sensitivityHigherWacc).toBeLessThan(model.sensitivityCenter ?? 0);
      expect(model.sensitivityHigherGrowth).toBeGreaterThan(model.sensitivityCenter ?? 0);
      expect(Math.abs((model.editedPerShare ?? 0) - (model.restoredPerShare ?? 0))).toBeGreaterThan(0.01);
      const engine = calculateBiotechRnpv(model.engineAssumptions);
      expect(Math.abs((model.restoredEquityValue ?? 0) * model.amountMultiplier - engine.equityValue)
        / engine.equityValue).toBeLessThanOrEqual(0.001);
      expect(Math.abs((model.restoredPerShare ?? 0) - engine.impliedSharePrice)).toBeLessThanOrEqual(0.01);
      expect(model.formulaErrors).toEqual([]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 250_000);

  it('exports a live incomplete P&C workbook when the latest net loss reserves are missing', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-incomplete-aig-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });

    try {
      const client = new BackendApiClient(await backend.start());
      const completeData = await client.getUnifiedCompany('AIG', 5);
      const incomplete = structuredClone(completeData);
      const latest = incomplete.canonical_financials.annual.at(-1);
      const reserveLine = latest?.insurance?.unpaid_loss_reserves;
      if (!latest?.insurance || typeof reserveLine?.value !== 'number') {
        throw new Error('Live AIG latest net loss reserves are not source-backed for the redaction test.');
      }
      const redacted = {
        ...reserveLine,
        source: 'missing' as const,
        value: null,
        method: 'redacted_from_live_payload_for_incomplete_insurance_test',
      };
      latest.insurance.unpaid_loss_reserves = redacted;
      if (incomplete.canonical_financials.latest?.insurance) {
        incomplete.canonical_financials.latest.insurance.unpaid_loss_reserves = redacted;
      }
      incomplete.model_eligibility.status = 'input_required';
      incomplete.model_eligibility.model_route_available = true;
      incomplete.model_eligibility.supported_by_current_engine = false;
      incomplete.model_eligibility.allowed_models = ['insurance_pnc_residual_income'];
      incomplete.model_eligibility.required_input_readiness = {
        ...incomplete.model_eligibility.required_input_readiness,
        unpaid_loss_reserves: false,
      };
      incomplete.model_eligibility.missing_input_gaps = [{
        key: 'unpaid_loss_reserves',
        label: 'Ending net loss reserves',
        reason: 'The latest filed reserve balance must be provided before the reserve roll-forward and valuation can be calculated.',
      }];

      const redactedBackend = {
        getUnifiedCompany: async (ticker: string, years: number) => {
          expect(ticker).toBe('AIG');
          expect(years).toBe(5);
          return incomplete;
        },
        exportDcf: (payload: Parameters<typeof client.exportDcf>[0]) => client.exportDcf(payload),
      };
      const result = await runValuationJob('AIG', redactedBackend);
      expect(result.status).toBe('input_required');
      expect(result.results).toBeNull();
      expect(result.missingInputs.some((input) => input.key === 'unpaid_loss_reserves'
        && input.fiscalYear === latest.year && input.unit === 'USD actual' && input.sourceReferenceRequired)).toBe(true);

      const workbookPath = join(home, 'incomplete_aig_dcf.xlsx');
      await writeFile(workbookPath, result.workbookBytes);
      const completeResult = await runValuationJob('AIG', {
        getUnifiedCompany: async () => completeData,
        exportDcf: (payload) => client.exportDcf(payload),
      });
      if (completeResult.status !== 'ready') throw new Error('Live AIG complete model did not reach ready status.');
      const completeWorkbookPath = join(home, 'complete_aig_insurance_model.xlsx');
      await writeFile(completeWorkbookPath, completeResult.workbookBytes);
      const reserveSource = reserveLine.sources[0];
      if (!reserveSource?.accession || !reserveSource.filed) {
        throw new Error('Live AIG ending reserve has no source reference for workbook restoration.');
      }
      const sourceReference = `${reserveSource.concept ?? 'SEC filing'} accession ${reserveSource.accession} filed ${reserveSource.filed}`;
      const inspection = await inspectIncompleteInsuranceWorkbook(
        workbookPath,
        reserveLine.value,
        sourceReference,
        completeWorkbookPath,
      );
      expect(inspection.sheets).toContain('Insurance Model');
      expect(inspection.required_input_row).toBeGreaterThan(0);
      expect(inspection.input_value).toBeNull();
      expect(inspection.input_font_rgb?.slice(-6)).toBe('0000FF');
      expect(inspection.input_locked).toBe(false);
      expect(inspection.source_required).toBe('Yes');
      expect(String(inspection.status_value)).toContain('INCOMPLETE');
      expect(inspection.reserve_value === null || inspection.reserve_value === '').toBe(true);
      expect(inspection.reserve_check === null || inspection.reserve_check === '').toBe(true);
      expect(String(inspection.reserve_formula)).toContain('Input Required');
      expect(String(inspection.enterprise_value_note)).toContain('Not applicable — common-equity insurance model');
      expect(inspection.data_review_row).toBeGreaterThan(0);
      expect(inspection.data_review_values?.[4]).toBe(`FY${latest.year}`);
      expect(inspection.data_review_values?.[5]).toBe('USD actual');
      expect(inspection.data_review_values?.[7]).toContain(`Input Required!F${inspection.required_input_row}`);
      expect(String(inspection.data_review_values?.[8])).toContain(`'Input Required'!G${inspection.required_input_row}`);
      expect(inspection.data_review_status).toBe('INPUT REQUIRED');
      expect(inspection.guarded_formulas?.C86).toContain('Input Required');
      expect(inspection.guarded_formulas?.C82).toContain('$B$22');
      expect(inspection.guarded_formulas?.C86).toContain('C82');
      expect(inspection.guarded_formulas?.C101).toContain('Input Required');
      expect(inspection.guarded_formulas?.B108).toContain('Input Required');
      for (const value of Object.values(inspection.guarded_values ?? {})) {
        expect(value === null || value === '').toBe(true);
      }
      expect(inspection.restored_status).toBe('READY');
      expect(inspection.restored_source_reference).toBe(sourceReference);
      expect(inspection.restored_equity_value).toEqual(expect.any(Number));
      expect(inspection.complete_equity_value).toEqual(expect.any(Number));
      expect(inspection.restored_per_share).toEqual(expect.any(Number));
      expect(inspection.complete_per_share).toEqual(expect.any(Number));
      expect(Math.abs(inspection.restored_equity_value! - inspection.complete_equity_value!)
        / Math.abs(inspection.complete_equity_value!)).toBeLessThanOrEqual(0.001);
      expect(Math.abs(inspection.restored_per_share! - inspection.complete_per_share!)).toBeLessThanOrEqual(0.01);
      expect(inspection.formula_errors).toEqual([]);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('keeps FCFF and valuation scale independent of market price and preserves accounting units', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-units-aapl-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });

    try {
      const baseUrl = await backend.start();
      const payload = await new BackendApiClient(baseUrl).getUnifiedCompany('AAPL', 5);
      expect(payload.profile.ticker).toBe('AAPL');
      const profile = mapNativeProfile(payload.profile, payload.financials_native, payload.market);
      const historicals = mapCanonicalFinancialsToHistoricals(payload.canonical_financials, payload.market, profile);
      const assumptions = buildBaseAssumptions(
        historicals,
        {
          rf: payload.valuation_context.risk_free_rate ?? undefined,
          mrp: payload.valuation_context.equity_risk_premium ?? undefined,
        },
        12,
        profile,
      );
      const base = calculateDCF(historicals, assumptions, {});
      const firstForecast = base.forecasts[0];
      expect(firstForecast?.stockBasedComp ?? 0).toBeGreaterThan(0);

      const expectedFcff = firstForecast!.ebit * (1 - assumptions.taxRate)
        + firstForecast!.depreciation
        - firstForecast!.capex
        - firstForecast!.nwcChange;
      expect(firstForecast!.fcff).toBeCloseTo(expectedFcff, 2);

      const monetarySeries = [
        'revenue', 'costOfRevenue', 'grossProfit', 'ebitda', 'ebit', 'interestExpense',
        'incomeTaxExpense', 'netIncome', 'depreciation', 'capex', 'nwcChange',
        'accountsReceivable', 'inventory', 'accountsPayable', 'cash', 'marketableSecurities',
        'totalCurrentAssets', 'otherCurrentAssets', 'totalAssets', 'totalDebt', 'currentDebt',
        'longTermDebt', 'shareholdersEquity', 'ppeNet', 'otherAssets', 'otherLiabilities',
        'totalLiabilities', 'totalCurrentLiabilities', 'otherCurrentLiabilities',
        'deferredRevenue', 'retainedEarnings', 'researchAndDevelopment',
        'generalAndAdministrative', 'stockBasedComp', 'cfo', 'dividendsPaid',
      ] as const;
      const scaledHistoricalData = {...historicals};
      const scaledRecord = scaledHistoricalData as unknown as Record<string, unknown>;
      const historicalRecord = historicals as unknown as Record<string, unknown>;
      for (const field of monetarySeries) {
        const values = historicalRecord[field];
        if (Array.isArray(values)) scaledRecord[field] = values.map((value) => value === null ? null : Number(value) * 1_000);
      }
      const scaledAssumptions = {
        ...assumptions,
        currentDebt: assumptions.currentDebt === undefined ? undefined : assumptions.currentDebt * 1_000,
        annualDebtRepayment: assumptions.annualDebtRepayment === undefined ? undefined : assumptions.annualDebtRepayment * 1_000,
        startingInvestedCapital: assumptions.startingInvestedCapital === undefined ? undefined : assumptions.startingInvestedCapital * 1_000,
      };
      const scaled = calculateDCF(scaledHistoricalData as HistoricalData, scaledAssumptions, {});
      expect(scaled.equityValue / base.equityValue).toBeCloseTo(1_000, 0);
    } finally {
      await backend.stop();
      await rm(home, { recursive: true, force: true });
    }
  }, 250_000);

  it('maps live common equity and operating cash flow to the filed SEC rows', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-canonical-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });

    try {
      const client = new BackendApiClient(await backend.start());
      for (const ticker of ['AAPL', 'JPM', 'AIG', 'PLD', 'NEE']) {
        const payload = await client.getUnifiedCompany(ticker, 5);
        const canonical = payload.canonical_financials as {
          years: number[];
          latest: {
            book_value: { value: number; concept: string | null };
            cfo: { value: number; concept: string | null };
          };
        };
        const year = canonical.years[canonical.years.length - 1];
        const yearKey = `FY ${year}`;
        const equityRow = payload.financials_native.statements.balance_sheet.find(
          (row) => row.concept === 'StockholdersEquity' && typeof row[yearKey] === 'number',
        );
        const nonControllingInterestRow = payload.financials_native.statements.balance_sheet.find(
          (row) => ['MinorityInterest', 'NoncontrollingInterest'].includes(String(row.concept)) && typeof row[yearKey] === 'number',
        );
        const cfoRow = payload.financials_native.statements.cashflow_statement.find(
          (row) => row.concept === 'NetCashProvidedByUsedInOperatingActivities' && typeof row[yearKey] === 'number',
        );
        const stockCompRow = ticker === 'AAPL'
          ? payload.financials_native.statements.cashflow_statement.find(
              (row) => row.concept === 'ShareBasedCompensation' && typeof row[yearKey] === 'number',
            )
          : undefined;

        expect(equityRow, `${ticker} ${year} parent equity source row`).toBeDefined();
        expect(cfoRow, `${ticker} ${year} CFO source row`).toBeDefined();
        expect(canonical.latest.book_value.concept, `${ticker} canonical book-value concept`)
          .toBe(equityRow?.concept);
        expect(canonical.latest.book_value.value, `${ticker} canonical book value`)
          .toBe(equityRow?.[yearKey]);
        expect(canonical.latest.cfo.concept, `${ticker} canonical CFO concept`)
          .toBe(cfoRow?.concept);
        expect(canonical.latest.cfo.value, `${ticker} canonical CFO`)
          .toBe(cfoRow?.[yearKey]);

        const profile = mapNativeProfile(payload.profile, payload.financials_native, payload.market);
        const historicals = mapCanonicalFinancialsToHistoricals(payload.canonical_financials, payload.market, profile);
        expect(historicals.shareholdersEquity.at(-1), `${ticker} mapped shareholders equity`)
          .toBe(canonical.latest.book_value.value);
        expect(historicals.nonControllingInterest?.at(-1), `${ticker} mapped noncontrolling interest`)
          .toBe(nonControllingInterestRow ? Number(nonControllingInterestRow[yearKey]) : 0);
        expect(historicals.cfo?.at(-1), `${ticker} mapped CFO`)
          .toBe(canonical.latest.cfo.value);
        expect(historicals.balanceSheetCheck?.at(-1), `${ticker} historical balance-sheet check`)
          .toBe(0);
        if (ticker === 'AAPL') {
          expect(stockCompRow, 'AAPL share-based compensation source row').toBeDefined();
          expect(historicals.stockBasedComp?.at(-1), 'AAPL stock-based compensation')
            .toBe(stockCompRow?.[yearKey]);
        }
      }
    } finally {
      await backend.stop();
      await rm(home, { recursive: true, force: true });
    }
  }, 300_000);

  it('maps operating DCF history to exact live AAPL SEC rows', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-canonical-operating-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });

    try {
      const payload = await new BackendApiClient(await backend.start()).getUnifiedCompany('AAPL', 5);
      const canonical = payload.canonical_financials as {
        years: number[];
        latest: Record<string, {
          value: number | null;
          source: string;
          method: string;
          concept: string | null;
          sources?: Array<{
            concept: string | null;
            label: string | null;
            statement: string | null;
            fiscal_period: string | null;
            accession: string | null;
            filed: string | null;
            currency: string | null;
            unit: string | null;
            unit_scale: string | null;
          }>;
        } | undefined>;
      };
      const year = canonical.years[canonical.years.length - 1];
      const yearKey = `FY ${year}`;
      const sourceFilings = (payload.financials_native as unknown as {
        source_filings?: Array<{
          form: string;
          filing_date: string;
          report_date: string;
          accession_number: string;
        }>;
      }).source_filings ?? [];
      const sourceLines = [
        {field: 'cost_of_revenue', statement: 'income_statement', concept: 'CostOfGoodsAndServicesSold'},
        {field: 'income_tax_expense', statement: 'income_statement', concept: 'IncomeTaxExpenseBenefit'},
        {field: 'depreciation', statement: 'cashflow_statement', concept: 'DepreciationDepletionAndAmortization'},
        {field: 'stock_based_comp', statement: 'cashflow_statement', concept: 'ShareBasedCompensation'},
        {field: 'accounts_receivable', statement: 'balance_sheet', concept: 'AccountsReceivableNetCurrent'},
        {field: 'inventory', statement: 'balance_sheet', concept: 'InventoryNet'},
        {field: 'accounts_payable', statement: 'balance_sheet', concept: 'AccountsPayableCurrent'},
        {field: 'total_assets', statement: 'balance_sheet', concept: 'Assets'},
        {field: 'total_liabilities', statement: 'balance_sheet', concept: 'Liabilities'},
        {field: 'operating_lease_liability_current', statement: 'balance_sheet', concept: 'OperatingLeaseLiabilityCurrent'},
        {field: 'operating_lease_liability_noncurrent', statement: 'balance_sheet', concept: 'OperatingLeaseLiabilityNoncurrent'},
        {field: 'long_term_debt_current', statement: 'balance_sheet', concept: 'LongTermDebtCurrent'},
        {field: 'long_term_debt', statement: 'balance_sheet', concept: 'LongTermDebtNoncurrent'},
        {field: 'retained_earnings', statement: 'balance_sheet', concept: 'RetainedEarningsAccumulatedDeficit'},
        {field: 'dividends_paid', statement: 'cashflow_statement', concept: 'PaymentsOfDividendsCommonStock'},
      ] as const;

      const interestExpenseRow = payload.financials_native.statements.income_statement.find(
        (row) => /interest.{0,20}expense/i.test(String(row.concept || row.label || ''))
          && row.concept !== 'NonoperatingIncomeExpense'
          && typeof row[yearKey] === 'number',
      );
      expect(interestExpenseRow, 'AAPL FY2025 has no separately reported interest-expense row').toBeUndefined();
      expect(canonical.latest.interest_expense?.value, 'missing interest expense remains null').toBeNull();
      expect(canonical.latest.interest_expense?.source, 'missing interest expense remains explicitly missing').toBe('missing');

      for (const sourceLine of sourceLines) {
        const row = payload.financials_native.statements[sourceLine.statement].find(
          (candidate) => candidate.concept === sourceLine.concept && typeof candidate[yearKey] === 'number',
        );
        const canonicalLine = canonical.latest[sourceLine.field];
        expect(row, `AAPL ${year} SEC row ${sourceLine.concept}`).toBeDefined();
        expect(canonicalLine?.source, `${sourceLine.field} source status`).toBe('sec_native');
        expect(canonicalLine?.concept, `${sourceLine.field} selected concept`).toBe(sourceLine.concept);
        expect(canonicalLine?.value, `${sourceLine.field} reported value`).toBe(row?.[yearKey]);
        expect(canonicalLine?.sources, `${sourceLine.field} preserves its SEC source row`).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              concept: sourceLine.concept,
              label: row?.label,
              statement: row?.statement,
              fiscal_period: yearKey,
            }),
          ]),
        );
      }
      expect(canonical.latest.capex?.sources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            concept: 'PaymentsToAcquirePropertyPlantAndEquipment',
            accession: expect.stringMatching(/^\d{10}-\d{2}-\d{6}$/),
            filed: expect.stringMatching(/^20\d{2}-\d{2}-\d{2}$/),
            unit: 'USD',
          }),
        ]),
      );

      const marketableCurrent = payload.financials_native.source_facts?.find(
        (fact) => fact.concept.endsWith('MarketableSecuritiesCurrent')
          && fact.period_end.startsWith(String(year)),
      );
      const marketableNoncurrent = payload.financials_native.source_facts?.find(
        (fact) => fact.concept.endsWith('MarketableSecuritiesNoncurrent')
          && fact.period_end.startsWith(String(year)),
      );
      expect(marketableCurrent, 'AAPL current marketable securities SEC fact').toBeDefined();
      expect(marketableNoncurrent, 'AAPL noncurrent marketable securities SEC fact').toBeDefined();
      expect(canonical.latest.marketable_securities?.value, 'marketable securities uses both filed maturity classes')
        .toBe(Number(marketableCurrent?.value) + Number(marketableNoncurrent?.value));
      expect(canonical.latest.marketable_securities?.method)
        .toBe('sum_current_and_noncurrent_marketable_securities');

      const dilutedShareFact = payload.financials_native.source_facts?.find(
        (fact) => fact.concept.endsWith('WeightedAverageNumberOfDilutedSharesOutstanding')
          && fact.period_end.startsWith(String(year)),
      );
      expect(dilutedShareFact, 'AAPL diluted weighted-average shares SEC fact').toBeDefined();
      expect(canonical.latest.shares?.concept ?? '', 'the per-share model uses diluted shares')
        .toContain('WeightedAverageNumberOfDilutedSharesOutstanding');
      expect(canonical.latest.shares?.value, 'diluted shares reconcile to the filed SEC fact')
        .toBe(dilutedShareFact?.value);

      const otherCurrentLiabilitiesFact = payload.financials_native.source_facts?.find(
        (fact) => fact.concept.endsWith('OtherLiabilitiesCurrent')
          && fact.period_end.startsWith(String(year)),
      );
      const deferredRevenueFact = payload.financials_native.source_facts?.find(
        (fact) => fact.concept.endsWith('ContractWithCustomerLiability')
          && fact.period_end.startsWith(String(year)),
      );
      expect(otherCurrentLiabilitiesFact, 'AAPL other current liabilities SEC fact').toBeDefined();
      expect(deferredRevenueFact, 'AAPL contract liability SEC fact').toBeDefined();
      expect(canonical.latest.other_current_liabilities?.value, 'other current liabilities use the filed XBRL fact')
        .toBe(otherCurrentLiabilitiesFact?.value);
      expect(canonical.latest.deferred_revenue?.value, 'deferred revenue uses the filed contract liability fact')
        .toBe(deferredRevenueFact?.value);
      const commercialPaperFact = payload.financials_native.source_facts?.find(
        (fact) => fact.concept.endsWith('CommercialPaper')
          && fact.period_end.startsWith(String(year)),
      );
      expect(commercialPaperFact, 'AAPL commercial paper SEC fact').toBeDefined();
      expect(canonical.latest.commercial_paper?.value, 'commercial paper is mapped separately from term debt')
        .toBe(commercialPaperFact?.value);
      expect(canonical.latest.current_debt?.value, 'current debt includes current maturities and commercial paper')
        .toBe(Number(canonical.latest.long_term_debt_current?.value) + Number(commercialPaperFact?.value));
      expect(canonical.latest.lease_liabilities?.value, 'lease obligations are separately sourced')
        .toBe(Number(canonical.latest.operating_lease_liability_current?.value) + Number(canonical.latest.operating_lease_liability_noncurrent?.value));
      const revenueSources = canonical.latest.revenue?.sources ?? [];
      expect(revenueSources.length, 'AAPL revenue carries a live SEC filing source').toBeGreaterThan(0);
      expect(canonical.latest.preferred_equity?.value, 'unreported preferred equity is explicitly not applicable')
        .toBeNull();
      expect(canonical.latest.preferred_equity?.source).toBe('not_applicable');
      expect(canonical.latest.preferred_equity?.method)
        .toBe('no_preferred_stock_fact_disclosed_in_filed_10k');
      expect(canonical.latest.preferred_equity?.sources?.some((source) =>
        source.accession === revenueSources[0]?.accession && source.filed === revenueSources[0]?.filed,
      )).toBe(true);

      for (const source of revenueSources) {
        const filing = sourceFilings.find((candidate) => candidate.accession_number === source.accession);
        expect(filing, 'canonical source accession resolves to an SEC filing').toBeDefined();
        expect(filing?.form).toMatch(/^10-K(?:\/A)?$/);
        expect(source.fiscal_period).toBe(yearKey);
        expect(source.filed).toBe(filing?.filing_date);
        expect(source.currency).toBe('USD');
        expect(source.unit).toBe('USD');
        expect(source.unit_scale).toBe('actual');
      }
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('keeps five live DCF forecast years when the source history contains three years', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-short-history-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });

    try {
      const client = new BackendApiClient(await backend.start());
      const result = await runValuationJob('AAPL', client);
      const history = structuredClone(result.exportPayload.historicals);
      history.years = history.years.slice(-3);
      for (const statement of [history.income, history.balance, history.cashflow]) {
        for (const [key, values] of Object.entries(statement)) {
          statement[key] = values.slice(-3);
        }
      }
      const workbookPath = join(home, 'aapl_short_history.xlsx');
      const workbookBytes = await client.exportDcf({...result.exportPayload, historicals: history});
      await writeFile(workbookPath, workbookBytes);
      const spec = liveCompanyCases.find((item) => item.ticker === 'AAPL');
      if (!spec) throw new Error('AAPL live workbook inspection settings are missing.');
      const workbook = await inspectWorkbook(workbookPath, spec);

      expect(workbook.model_timeline_headers.slice(0, 2)).toEqual([null, null]);
      expect(workbook.model_timeline_headers.slice(-5)).toEqual(
        result.results.forecasts.map((forecast) => `FY${forecast.year}E`),
      );
      expect(workbook.model_timeline_headers.filter((header) => header?.endsWith('E'))).toHaveLength(5);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('maps live AAPL DCF history from canonical SEC fields', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-canonical-history-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });

    try {
      const payload = await new BackendApiClient(await backend.start()).getUnifiedCompany('AAPL', 5);
      const profile = mapNativeProfile(payload.profile, payload.financials_native, payload.market);
      const historicals = mapCanonicalFinancialsToHistoricals(payload.canonical_financials, payload.market, profile);
      const canonical = payload.canonical_financials as {
        years: number[];
        latest: {
          revenue: {value: number};
          cost_of_revenue: {value: number};
          depreciation: {value: number};
          capex: {value: number};
          book_value: {value: number};
        };
      };
      const lastIndex = canonical.years.length - 1;

      expect(historicals.revenue.at(-1), 'revenue is taken from canonical history')
        .toBe(canonical.latest.revenue.value);
      expect(historicals.costOfRevenue.at(-1), 'cost of revenue is taken from canonical history')
        .toBe(canonical.latest.cost_of_revenue.value);
      expect(historicals.depreciation.at(-1), 'D&A is taken from canonical history')
        .toBe(canonical.latest.depreciation.value);
      expect(historicals.capex.at(-1), 'capex is taken from canonical history')
        .toBe(canonical.latest.capex.value);
      expect(historicals.shareholdersEquity.at(-1), 'common equity is taken from canonical history')
        .toBe(canonical.latest.book_value.value);
      expect(historicals.operatingLeaseLiabilities?.at(-1), 'lease liabilities are retained as a separate sourced claim')
        .toBe(canonical.latest.lease_liabilities.value);
      expect(historicals.interestExpense.at(-1), 'a missing expense remains null rather than becoming zero')
        .toBeNull();
      expect(historicals.years[lastIndex], 'canonical fiscal year is preserved')
        .toBe(canonical.years[lastIndex]);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('reconciles CAT combined operating costs before deriving industrial gross profit', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-cat-cost-reconciliation-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });

    try {
      const payload = await new BackendApiClient(await backend.start()).getUnifiedCompany('CAT', 5);
      const annual = payload.canonical_financials.annual.at(-1);
      if (!annual) throw new Error('CAT filed annual history is unavailable.');
      const year = annual.year;
      const statementRows = payload.financials_native.statements.income_statement;
      const filedAmount = (concept: string): number => {
        const row = statementRows.find((item) => item.concept === concept);
        const value = row?.[`FY ${year}`];
        if (typeof value !== 'number') throw new Error(`CAT FY${year} SEC row ${concept} is unavailable.`);
        return value;
      };
      const totalOperatingCosts = filedAmount('CostsAndExpenses');
      const sellingGeneralAndAdministrative = Math.abs(filedAmount('SellingGeneralAndAdministrativeExpense'));
      const researchAndDevelopment = Math.abs(filedAmount('ResearchAndDevelopmentExpense'));
      const otherOperatingExpense = Math.abs(filedAmount('OtherOperatingIncomeExpenseNet'));
      const expectedCostOfRevenue = totalOperatingCosts
        - sellingGeneralAndAdministrative
        - researchAndDevelopment
        - otherOperatingExpense;

      expect(annual.revenue.value).toBeGreaterThan(totalOperatingCosts);
      expect(annual.ebit.value).toBeCloseTo(annual.revenue.value! - totalOperatingCosts, 0);
      expect(annual.cost_of_revenue.value, 'COGS is the residual of filed total costs after reported operating expenses')
        .toBeCloseTo(expectedCostOfRevenue, 0);
      expect(annual.gross_profit.value).toBeCloseTo(annual.revenue.value! - expectedCostOfRevenue, 0);
      expect(annual.cost_of_revenue.method).toBe('combined_costs_less_reported_operating_expenses');
      expect(annual.cost_of_revenue.sources.map((source) => source.concept)).toContain('CostsAndExpenses');
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('reconciles live software working capital from non-cash operating assets and current liabilities', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-crm-working-capital-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });

    try {
      const payload = await new BackendApiClient(await backend.start()).getUnifiedCompany('CRM', 5);
      const annual = payload.canonical_financials.annual.at(-1);
      if (!annual) throw new Error('CRM filed annual history is unavailable.');
      const line = (annual as unknown as Record<string, unknown>).operating_net_working_capital as {
        value: number | null;
        source: string;
        method: string;
        sources: Array<{accession?: string | null; filed?: string | null}>;
      } | undefined;
      expect(line, 'the canonical payload exposes aggregate operating working capital').toBeDefined();
      expect(line?.source).toBe('derived');
      const filedValue = (field: 'total_current_assets' | 'cash' | 'total_current_liabilities' | 'current_debt'): number => {
        const value = annual[field].value;
        if (typeof value !== 'number') throw new Error(`CRM ${field} is unavailable.`);
        return value;
      };
      const securities = annual.marketable_securities;
      const securitiesValue = securities.source === 'not_applicable' ? 0 : securities.value;
      if (securitiesValue === null || securitiesValue === undefined) throw new Error('CRM marketable securities are incomplete.');
      const expected = filedValue('total_current_assets')
        - filedValue('cash')
        - securitiesValue
        - filedValue('total_current_liabilities')
        + filedValue('current_debt');
      expect(line?.value).toBeCloseTo(expected, 0);
      expect(line?.method).toBe('noncash_current_assets_less_current_liabilities_plus_current_debt');
      expect(line?.sources.length).toBeGreaterThanOrEqual(5);
      expect(line?.sources.every((source) => source.accession && source.filed)).toBe(true);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('maps P&C insurance drivers from AIG SEC filings', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-insurance-canonical-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });

    try {
      const payload = await new BackendApiClient(await backend.start()).getUnifiedCompany('AIG', 5);
      const canonical = payload.canonical_financials as unknown as {
        years: number[];
        annual: Array<{year: number; insurance?: Record<string, {
          value: number | null;
          source: string;
          method: string;
          concept: string | null;
          sources: Array<{
            concept: string | null;
            fiscal_period: string | null;
            accession: string | null;
            filed: string | null;
            currency: string | null;
            unit: string | null;
            unit_scale: string | null;
          }>;
        }>} >;
      };
      const latest = canonical.annual.at(-1);
      const insurance = latest?.insurance;
      expect(insurance, 'AIG has a separate P&C insurance source block').toBeDefined();
      expect(latest?.year).toBe(canonical.years.at(-1));
      expect(payload.model_eligibility.subtype).toBe('pc_insurer');
      expect(payload.model_eligibility.supported_by_current_engine).toBe(true);
      const expected2025: Record<string, number> = {
        net_premiums_written: 23_675_000_000,
        net_premiums_earned: 23_678_000_000,
        losses_and_lae: 13_968_000_000,
        acquisition_expenses: 4_295_000_000,
        general_operating_expenses: 3_083_000_000,
        underwriting_expenses: 7_378_000_000,
        loss_ratio: 0.590,
        expense_ratio: 0.311,
        combined_ratio: 0.901,
        prior_year_reserve_development: 0.021,
        underwriting_income: 2_332_000_000,
        net_investment_income: 3_433_000_000,
        invested_assets: 92_999_000_000,
        unpaid_loss_reserves_beginning: 40_142_000_000,
        losses_incurred_for_reserve_rollforward: 14_162_000_000,
        losses_paid_for_reserve_rollforward: 13_876_000_000,
        reserve_other_changes: 1_367_000_000,
        unpaid_loss_reserves: 41_795_000_000,
        reinsurance_recoverable: 28_871_000_000,
        gross_loss_reserves: 70_666_000_000,
        reserve_rollforward_check: 0,
        other_operations_pretax_income: -421_000_000,
        statutory_capital_surplus: 28_664_000_000,
        minimum_statutory_capital: 10_350_000_000,
        common_equity: 41_139_000_000,
        other_pretax_adjustments: -1_465_000_000,
      };
      for (const field of [
        'net_premiums_written', 'net_premiums_earned', 'losses_and_lae',
        'acquisition_expenses', 'general_operating_expenses', 'underwriting_expenses',
        'loss_ratio', 'expense_ratio', 'combined_ratio', 'prior_year_reserve_development',
        'underwriting_income', 'net_investment_income', 'invested_assets', 'unpaid_loss_reserves',
        'unpaid_loss_reserves_beginning', 'losses_incurred_for_reserve_rollforward',
        'losses_paid_for_reserve_rollforward', 'reserve_other_changes', 'reinsurance_recoverable',
        'gross_loss_reserves', 'reserve_rollforward_check',
        'other_operations_pretax_income', 'statutory_capital_surplus', 'minimum_statutory_capital',
        'other_pretax_adjustments',
      ]) {
        const line = insurance?.[field];
        expect(line, `AIG FY${latest?.year} ${field} line`).toBeDefined();
        expect(line?.value, `AIG FY${latest?.year} ${field} source value`).toEqual(expect.any(Number));
        if (latest?.year === 2025 && expected2025[field] !== undefined) {
          if (field.includes('ratio') || field === 'prior_year_reserve_development') {
            expect(line?.value, `AIG FY2025 ${field} matches the filed row`)
              .toBeCloseTo(expected2025[field], 6);
          } else {
            expect(line?.value, `AIG FY2025 ${field} matches the filed row`).toBe(expected2025[field]);
          }
        }
        expect(['sec_native', 'derived']).toContain(line?.source);
        expect(line?.sources.length).toBeGreaterThan(0);
        expect(line?.sources.every((source) =>
          source.fiscal_period === `FY ${latest?.year}`
          && /^\d{10}-\d{2}-\d{6}$/.test(source.accession || '')
          && /^20\d{2}-\d{2}-\d{2}$/.test(source.filed || '')
        )).toBe(true);
      }
      for (const field of [
        'common_equity', 'common_equity_distributions', 'diluted_shares', 'net_income',
        'tax_rate', 'reported_pretax_income', 'other_pretax_adjustments',
      ]) {
        const line = insurance?.[field];
        expect(line?.value, `AIG FY${latest?.year} ${field} source value`).toEqual(expect.any(Number));
        expect(line?.source).toMatch(/^(sec_native|derived)$/);
        expect(line?.sources.every((source) => Boolean(source.accession && source.filed))).toBe(true);
      }
      for (const field of [
        'net_premiums_written', 'net_premiums_earned', 'losses_and_lae',
        'acquisition_expenses', 'general_operating_expenses', 'underwriting_expenses',
        'loss_ratio', 'expense_ratio', 'combined_ratio', 'prior_year_reserve_development',
        'underwriting_income', 'net_investment_income', 'invested_assets',
        'unpaid_loss_reserves_beginning', 'losses_incurred_for_reserve_rollforward',
        'losses_paid_for_reserve_rollforward', 'reserve_other_changes', 'unpaid_loss_reserves',
        'reinsurance_recoverable', 'gross_loss_reserves', 'reserve_rollforward_check',
        'other_operations_pretax_income', 'statutory_capital_surplus', 'minimum_statutory_capital',
        'common_equity', 'common_equity_distributions', 'diluted_shares', 'net_income',
        'tax_rate', 'reported_pretax_income', 'other_pretax_adjustments',
      ]) {
        expect(payload.model_eligibility.required_input_readiness?.[field], `AIG readiness ${field}`)
          .toBe(true);
      }
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('calculates a sourced five-year P&C underwriting, reserve, and residual-income forecast', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-insurance-valuation-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });

    try {
      const data = await new BackendApiClient(await backend.start()).getUnifiedCompany('AIG', 5);
      const historical = mapCanonicalInsuranceFinancialsToHistoricals(data.canonical_financials);
      const assumptions = buildSourcedInsuranceModelAssumptions(data, historical);
      const result = calculateInsuranceValuation(historical, assumptions);
      expect(data.model_eligibility.supported_by_current_engine).toBe(true);
      expect(result.valuationBasis).toBe('equity');
      expect(result.enterpriseValue).toBeNull();
      expect(result.insuranceForecasts).toHaveLength(5);
      expect(result.equityValue).toBeGreaterThan(0);
      expect(result.impliedSharePrice).toBeGreaterThan(0);
      for (const forecast of result.insuranceForecasts) {
        expect(forecast.netPremiumsEarned * forecast.lossRatio).toBeCloseTo(forecast.lossesAndLAE, 6);
        expect(forecast.netPremiumsEarned * forecast.expenseRatio).toBeCloseTo(forecast.underwritingExpenses, 6);
        expect(forecast.netPremiumsEarned - forecast.lossesAndLAE - forecast.underwritingExpenses)
          .toBeCloseTo(forecast.underwritingIncome, 6);
        expect(forecast.lossRatio + forecast.expenseRatio).toBeCloseTo(forecast.combinedRatio, 9);
        expect(forecast.underwritingIncome + forecast.netInvestmentIncome
          + forecast.otherOperationsPretaxIncome + forecast.otherPretaxAdjustments)
          .toBeCloseTo(forecast.pretaxIncome, 6);
        expect(forecast.pretaxIncome - forecast.taxExpense).toBeCloseTo(forecast.netIncome, 6);
        expect(forecast.openingLossReserves + forecast.lossesIncurredForReserves
          - forecast.lossesPaid + forecast.reserveOtherChanges)
          .toBeCloseTo(forecast.endingNetLossReserves, 6);
        expect(forecast.endingGrossLossReserves)
          .toBeCloseTo(forecast.endingNetLossReserves + forecast.endingReinsuranceRecoverable, 6);
        expect(forecast.reserveRollforwardCheck).toBeCloseTo(0, 6);
        expect(forecast.openingCommonEquity + forecast.netIncome - forecast.commonDistributions)
          .toBeCloseTo(forecast.endingCommonEquity, 6);
        expect(forecast.endingStatutoryCapitalSurplus)
          .toBeGreaterThanOrEqual(forecast.requiredStatutoryCapital - 1e-9);
        expect(forecast.residualIncome)
          .toBeCloseTo(forecast.netIncome - result.costOfEquity * forecast.openingCommonEquity, 6);
      }

      const worseLossRatio = calculateInsuranceValuation(historical, {
        ...assumptions,
        lossRatio: assumptions.lossRatio + 0.01,
      });
      const higherInvestmentYield = calculateInsuranceValuation(historical, {
        ...assumptions,
        netInvestmentIncomeYield: assumptions.netInvestmentIncomeYield + 0.0025,
      });
      const higherCostOfEquity = calculateInsuranceValuation(historical, {
        ...assumptions,
        riskFreeRate: assumptions.riskFreeRate + 0.005,
      });
      expect(worseLossRatio.equityValue).toBeLessThan(result.equityValue);
      expect(higherInvestmentYield.equityValue).toBeGreaterThan(result.equityValue);
      expect(higherCostOfEquity.equityValue).toBeLessThan(result.equityValue);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('maps PLD FFO, Core FFO, same-store NOI, capex, and source lineage from SEC filings', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-reit-canonical-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {...process.env, HOME: home, DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite')},
    });

    try {
      const data = await new BackendApiClient(await backend.start()).getUnifiedCompany('PLD', 5);
      const historical = mapCanonicalReitFinancialsToHistoricals(data.canonical_financials);
      const latest = historical.annual.at(-1);
      if (!latest?.reit) throw new Error('PLD live REIT history is unavailable.');
      expect(data.model_eligibility.subtype).toBe('equity_reit');
      expect(latest.year).toBe(data.canonical_financials.years.at(-1));
      const expected2025: Record<string, number> = {
        net_income_available_to_common: 3_322_349_000,
        real_estate_depreciation: 2_539_000_000,
        disposition_gains_nareit_adjustment: -685_000_000,
        nci_nareit_adjustment: -47_000_000,
        unconsolidated_nareit_adjustment: 551_000_000,
        nareit_ffo: 5_680_000_000,
        modified_ffo_fx_adjustment: 125_000_000,
        modified_ffo_deferred_tax_adjustment: 4_000_000,
        modified_ffo_nci_adjustment: -1_000_000,
        modified_ffo_unconsolidated_adjustment: -29_000_000,
        modified_ffo: 5_779_000_000,
        core_ffo_disposition_adjustment: -258_000_000,
        core_ffo_tax_adjustment: 26_000_000,
        core_ffo_debt_extinguishment_adjustment: 3_000_000,
        core_ffo_nci_adjustment: 15_000_000,
        core_ffo_unconsolidated_adjustment: -4_000_000,
        core_ffo: 5_561_000_000,
        tenant_improvements_and_lease_commissions: 562_197_000,
        property_improvements: 327_355_000,
        same_store_noi_net_effective: 1_554_000_000,
        same_store_noi_cash: 1_427_000_000,
        real_estate_segment_noi: 6_187_608_000,
        strategic_capital_segment_noi: 321_836_000,
      };
      for (const [field, expected] of Object.entries(expected2025)) {
        const line = latest.reit[field as keyof typeof latest.reit];
        expect(line.value, `PLD FY2025 ${field} reconciles to its 10-K`).toBe(expected);
        expect(['sec_native', 'derived']).toContain(line.source);
        expect(line.sources.length).toBeGreaterThan(0);
        expect(line.sources.every((source) =>
          source.accession === '0001193125-26-051453'
          && source.filed === '2026-02-13'
          && source.fiscal_period === 'FY 2025'
          && source.currency === 'USD'
          && ['actual', 'millions', 'thousands'].includes(String(source.unit_scale))
        )).toBe(true);
      }
      expect(latest.reit.occupancy.value).toBeCloseTo(0.956, 6);
      expect(latest.reit.nareit_ffo.value)
        .toBeCloseTo(latest.reit.nareit_bridge_net_income.value!
          + latest.reit.real_estate_depreciation.value!
          + latest.reit.disposition_gains_nareit_adjustment.value!
          + latest.reit.nci_nareit_adjustment.value!
          + latest.reit.unconsolidated_nareit_adjustment.value!, 0);
      expect(latest.reit.core_ffo.value)
        .toBeCloseTo(latest.reit.modified_ffo.value!
          + latest.reit.core_ffo_disposition_adjustment.value!
          + latest.reit.core_ffo_tax_adjustment.value!
          + latest.reit.core_ffo_debt_extinguishment_adjustment.value!
          + latest.reit.core_ffo_nci_adjustment.value!
          + latest.reit.core_ffo_unconsolidated_adjustment.value!, 0);
      for (const year of [2023, 2024]) {
        const item = historical.annual.find((row) => row.year === year);
        expect(item?.reit?.nareit_ffo.value, `PLD FY${year} NAREIT FFO from a filed comparative reconciliation`)
          .toEqual(expect.any(Number));
        expect(item?.reit?.core_ffo.value, `PLD FY${year} Core FFO from a filed comparative reconciliation`)
          .toEqual(expect.any(Number));
        expect(item?.reit?.core_ffo.sources.every((source) => source.accession && source.filed && source.fiscal_period === `FY ${year}`))
          .toBe(true);
      }
      expect(historical.annual.every((item) => item.reit?.analyst_affo.source === 'derived')).toBe(true);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('calculates a five-year PLD same-store NOI, Core FFO, analyst AFFO, and NAV forecast', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-reit-valuation-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {...process.env, HOME: home, DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite')},
    });

    try {
      const data = await new BackendApiClient(await backend.start()).getUnifiedCompany('PLD', 5);
      const historical = mapCanonicalReitFinancialsToHistoricals(data.canonical_financials);
      const assumptions = buildSourcedReitModelAssumptions(data, historical);
      const result = calculateReitValuation(historical, assumptions);
      expect(result.valuationBasis).toBe('equity');
      expect(result.enterpriseValue).toBeNull();
      expect(result.reitForecasts).toHaveLength(5);
      expect(result.equityValue).toBeGreaterThan(0);
      expect(result.impliedSharePrice).toBeGreaterThan(0);
      expect(result.navPerShare).toBeGreaterThan(0);
      for (const forecast of result.reitForecasts) {
        expect(forecast.coreFfo - forecast.recurringCapex).toBeCloseTo(forecast.analystAffo, 6);
        expect(forecast.analystAffo * assumptions.payoutRatio).toBeCloseTo(forecast.commonDistributions, 6);
        expect(forecast.sameStoreNoi).toBeCloseTo(forecast.openingSameStoreNoi * (1 + assumptions.sameStoreNoiGrowth), 6);
        expect(forecast.presentValueAffo).toBeCloseTo(forecast.analystAffo / (1 + result.costOfEquity) ** (forecast.year - historical.years.at(-1)!), 4);
        expect(forecast.commonDistributions / forecast.analystAffo).toBeCloseTo(assumptions.payoutRatio, 6);
      }
      const higherNoiGrowth = calculateReitValuation(historical, {...assumptions, sameStoreNoiGrowth: assumptions.sameStoreNoiGrowth + 0.01});
      const higherCapRate = calculateReitValuation(historical, {...assumptions, navCapRate: assumptions.navCapRate + 0.005});
      const higherCostOfEquity = calculateReitValuation(historical, {...assumptions, riskFreeRate: assumptions.riskFreeRate + 0.005});
      const higherCapex = calculateReitValuation(historical, {...assumptions, recurringCapexRatio: assumptions.recurringCapexRatio + 0.01});
      expect(higherNoiGrowth.equityValue).toBeGreaterThan(result.equityValue);
      expect(higherCapRate.navValue).toBeLessThan(result.navValue);
      expect(higherCostOfEquity.equityValue).toBeLessThan(result.equityValue);
      expect(higherCapex.equityValue).toBeLessThan(result.equityValue);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('exports a live incomplete equity-REIT workbook when same-store NOI growth is missing', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-incomplete-pld-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {...process.env, HOME: home, DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite')},
    });

    try {
      const client = new BackendApiClient(await backend.start());
      const completeData = await client.getUnifiedCompany('PLD', 5);
      const incomplete = structuredClone(completeData);
      const latest = incomplete.canonical_financials.annual.at(-1);
      const growthLine = latest?.reit?.same_store_noi_growth;
      if (!latest?.reit || typeof growthLine?.value !== 'number') {
        throw new Error('Live PLD latest same-store NOI growth is not source-backed for the redaction test.');
      }
      const redacted = {
        ...growthLine,
        source: 'missing' as const,
        value: null,
        method: 'redacted_from_live_payload_for_incomplete_reit_test',
      };
      latest.reit.same_store_noi_growth = redacted;
      if (incomplete.canonical_financials.latest?.reit) {
        incomplete.canonical_financials.latest.reit.same_store_noi_growth = redacted;
      }
      incomplete.model_eligibility.status = 'input_required';
      incomplete.model_eligibility.model_route_available = true;
      incomplete.model_eligibility.supported_by_current_engine = false;
      incomplete.model_eligibility.allowed_models = ['reit_affo'];
      incomplete.model_eligibility.required_input_readiness = {
        ...incomplete.model_eligibility.required_input_readiness,
        same_store_noi_growth: false,
      };
      incomplete.model_eligibility.missing_input_gaps = [{
        key: 'same_store_noi_growth',
        label: 'Filed same-store NOI growth',
        reason: 'The latest filed same-store NOI growth is required for the AFFO and property-NOI forecast.',
      }];

      const result = await (async () => {
        try {
          return await runValuationJob('PLD', {
            getUnifiedCompany: async (ticker: string, years: number) => {
              expect(ticker).toBe('PLD');
              expect(years).toBe(5);
              return incomplete;
            },
            exportDcf: (payload: Parameters<typeof client.exportDcf>[0]) => client.exportDcf(payload),
          });
        } catch (error) {
          // Live market/valuation context is sometimes stale or unavailable; the
          // engine must fail closed with exactly this family and write nothing.
          const message = error instanceof Error ? error.message : String(error);
          const failClosed = /REIT valuation requires (a current, non-fallback market snapshot|current risk-free and equity-risk-premium inputs)|A market .* timestamp within 24 hours is required for the REIT valuation\./;
          expect(message, 'live PLD redacted run fails closed on market context').toMatch(failClosed);
          const marketStatus = completeData.data_quality?.market?.status;
          const contextStatus = completeData.data_quality?.valuation_context?.status;
          const maxAgeMs = 24 * 60 * 60 * 1000;
          const now = Date.now();
          const marketFresh = typeof completeData.market?.fetched_at_ms === 'number'
            && now - completeData.market.fetched_at_ms <= maxAgeMs;
          const contextFresh = typeof completeData.valuation_context?.fetched_at_ms === 'number'
            && now - completeData.valuation_context.fetched_at_ms <= maxAgeMs;
          const contextReady = ['live', 'cached'].includes(marketStatus)
            && completeData.market?.fallback_used !== true
            && ['live', 'cached'].includes(contextStatus)
            && marketFresh && contextFresh;
          expect(contextReady, 'live PLD market/valuation context is actually stale when the job fails closed').toBe(false);
          return null;
        }
      })();
      if (result === null) return;
      expect(result.status).toBe('input_required');
      expect(result.results).toBeNull();
      expect(result.missingInputs.some((input) => input.key === 'same_store_noi_growth'
        && input.fiscalYear === latest.year && input.unit === 'ratio' && input.sourceReferenceRequired)).toBe(true);

      const workbookPath = join(home, 'incomplete_pld_dcf.xlsx');
      await writeFile(workbookPath, result.workbookBytes);
      const completeResult = await runValuationJob('PLD', {
        getUnifiedCompany: async () => completeData,
        exportDcf: (payload) => client.exportDcf(payload),
      });
      if (completeResult.status !== 'ready') throw new Error('Live PLD complete model did not reach ready status.');
      const completeWorkbookPath = join(home, 'complete_pld_reit_model.xlsx');
      await writeFile(completeWorkbookPath, completeResult.workbookBytes);
      const growthSource = growthLine.sources[0];
      if (!growthSource?.accession || !growthSource.filed) {
        throw new Error('Live PLD same-store NOI growth has no source reference for workbook restoration.');
      }
      const sourceReference = `${growthSource.concept ?? 'SEC filing'} accession ${growthSource.accession} filed ${growthSource.filed}`;
      const inspection = await inspectIncompleteReitWorkbook(
        workbookPath,
        growthLine.value,
        sourceReference,
        completeWorkbookPath,
      );
      expect(inspection.sheets).toContain('REIT Model');
      expect(inspection.required_input_row).toBeGreaterThan(0);
      expect(inspection.input_value).toBeNull();
      expect(inspection.input_font_rgb?.slice(-6)).toBe('0000FF');
      expect(inspection.input_locked).toBe(false);
      expect(inspection.source_required).toBe('Yes');
      expect(String(inspection.status_value)).toContain('INCOMPLETE');
      expect(inspection.growth_value === null || inspection.growth_value === '').toBe(true);
      expect(String(inspection.growth_formula)).toContain('Input Required');
      expect(inspection.enterprise_value_note).toBe('Not applicable — common-equity AFFO model');
      expect(inspection.data_review_row).toBeGreaterThan(0);
      expect(inspection.data_review_values?.[4]).toBe(`FY${latest.year}`);
      expect(inspection.data_review_values?.[5]).toBe('ratio');
      expect(inspection.data_review_values?.[7]).toContain(`Input Required!F${inspection.required_input_row}`);
      expect(String(inspection.data_review_values?.[8])).toContain(`'Input Required'!G${inspection.required_input_row}`);
      expect(inspection.data_review_status).toBe('INPUT REQUIRED');
      expect(inspection.guarded_formulas?.C69).toContain('Input Required');
      expect(inspection.guarded_formulas?.C69).toContain('$B$51');
      expect(inspection.guarded_formulas?.B84).toContain('Input Required');
      expect(inspection.guarded_formulas?.B98).toContain('Input Required');
      for (const value of Object.values(inspection.guarded_values ?? {})) {
        expect(value === null || value === '').toBe(true);
      }
      expect(inspection.restored_status).toBe('READY');
      expect(inspection.restored_source_reference).toBe(sourceReference);
      expect(inspection.restored_equity_value).toEqual(expect.any(Number));
      expect(inspection.complete_equity_value).toEqual(expect.any(Number));
      expect(inspection.restored_per_share).toEqual(expect.any(Number));
      expect(inspection.complete_per_share).toEqual(expect.any(Number));
      expect(inspection.restored_nav_value).toEqual(expect.any(Number));
      expect(inspection.restored_nav_per_share).toEqual(expect.any(Number));
      expect(Math.abs(inspection.restored_equity_value! - inspection.complete_equity_value!)
        / Math.abs(inspection.complete_equity_value!)).toBeLessThanOrEqual(0.001);
      expect(Math.abs(inspection.restored_per_share! - inspection.complete_per_share!)).toBeLessThanOrEqual(0.01);
      expect(inspection.formula_errors).toEqual([]);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('exports a live incomplete mortgage-REIT workbook when average repo borrowings are missing', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-incomplete-agnc-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {...process.env, HOME: home, DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite')},
    });

    try {
      const client = new BackendApiClient(await backend.start());
      const completeData = await client.getUnifiedCompany('AGNC', 5);
      const incomplete = structuredClone(completeData);
      const latest = incomplete.canonical_financials.annual.at(-1);
      const repoBorrowings = latest?.mortgage_reit?.average_repo_borrowings;
      if (!latest?.mortgage_reit || typeof repoBorrowings?.value !== 'number') {
        throw new Error('Live AGNC latest average repo borrowings are not source-backed for the redaction test.');
      }
      const redacted = {
        ...repoBorrowings,
        source: 'missing' as const,
        value: null,
        method: 'redacted_from_live_payload_for_incomplete_mortgage_reit_test',
      };
      latest.mortgage_reit.average_repo_borrowings = redacted;
      if (incomplete.canonical_financials.latest?.mortgage_reit) {
        incomplete.canonical_financials.latest.mortgage_reit.average_repo_borrowings = redacted;
      }
      incomplete.model_eligibility.status = 'input_required';
      incomplete.model_eligibility.model_route_available = true;
      incomplete.model_eligibility.supported_by_current_engine = false;
      incomplete.model_eligibility.allowed_models = ['mortgage_reit_residual_income'];
      incomplete.model_eligibility.required_input_readiness = {
        ...incomplete.model_eligibility.required_input_readiness,
        average_repo_borrowings: false,
      };
      incomplete.model_eligibility.missing_input_gaps = [{
        key: 'average_repo_borrowings',
        label: 'Average repo borrowings',
        reason: 'The latest filed funding balance is required before spread, book roll-forward, and valuation outputs can be calculated.',
      }];

      const result = await runValuationJob('AGNC', {
        getUnifiedCompany: async (ticker: string, years: number) => {
          expect(ticker).toBe('AGNC');
          expect(years).toBe(5);
          return incomplete;
        },
        exportDcf: (payload: Parameters<typeof client.exportDcf>[0]) => client.exportDcf(payload),
      });
      expect(result.status).toBe('input_required');
      expect(result.results).toBeNull();
      expect(result.missingInputs.some((input) => input.key === 'average_repo_borrowings'
        && input.fiscalYear === latest.year && input.unit === 'USD actual' && input.sourceReferenceRequired)).toBe(true);

      const workbookPath = join(home, 'incomplete_agnc_dcf.xlsx');
      await writeFile(workbookPath, result.workbookBytes);
      const completeResult = await runValuationJob('AGNC', {
        getUnifiedCompany: async () => completeData,
        exportDcf: (payload) => client.exportDcf(payload),
      });
      if (completeResult.status !== 'ready') throw new Error('Live AGNC complete model did not reach ready status.');
      const completeWorkbookPath = join(home, 'complete_agnc_mortgage_reit_model.xlsx');
      await writeFile(completeWorkbookPath, completeResult.workbookBytes);
      const repoSource = repoBorrowings.sources[0];
      if (!repoSource?.accession || !repoSource.filed) {
        throw new Error('Live AGNC average repo borrowings has no source reference for workbook restoration.');
      }
      const sourceReference = `${repoSource.concept ?? 'SEC filing'} accession ${repoSource.accession} filed ${repoSource.filed}`;
      const inspection = await inspectIncompleteMortgageReitWorkbook(
        workbookPath,
        repoBorrowings.value,
        sourceReference,
        completeWorkbookPath,
      );
      expect(inspection.sheets).toContain('Mortgage REIT Model');
      expect(inspection.required_input_row).toBeGreaterThan(0);
      expect(inspection.input_value).toBeNull();
      expect(inspection.input_font_rgb?.slice(-6)).toBe('0000FF');
      expect(inspection.input_locked).toBe(false);
      expect(inspection.source_required).toBe('Yes');
      expect(String(inspection.status_value)).toContain('INCOMPLETE');
      expect(inspection.repo_value === null || inspection.repo_value === '').toBe(true);
      expect(inspection.spread_check === null || inspection.spread_check === '').toBe(true);
      expect(String(inspection.repo_formula)).toContain('Input Required');
      expect(inspection.enterprise_value_note).toBe('Not applicable');
      expect(inspection.data_review_row).toBeGreaterThan(0);
      expect(inspection.data_review_values?.[4]).toBe(`FY${latest.year}`);
      expect(inspection.data_review_values?.[5]).toBe('USD actual');
      expect(inspection.data_review_values?.[7]).toContain(`Input Required!F${inspection.required_input_row}`);
      expect(String(inspection.data_review_values?.[8])).toContain(`'Input Required'!G${inspection.required_input_row}`);
      expect(inspection.data_review_status).toBe('INPUT REQUIRED');
      expect(inspection.guarded_formulas?.F50).toContain('Input Required');
      expect(inspection.guarded_formulas?.F61).toContain('Input Required');
      expect(inspection.guarded_formulas?.F64).toContain('Input Required');
      expect(inspection.guarded_formulas?.B71).toContain('Input Required');
      for (const value of Object.values(inspection.guarded_values ?? {})) {
        expect(value === null || value === '').toBe(true);
      }
      expect(inspection.restored_status).toBe('READY');
      expect(inspection.restored_source_reference).toBe(sourceReference);
      expect(inspection.restored_equity_value).toEqual(expect.any(Number));
      expect(inspection.complete_equity_value).toEqual(expect.any(Number));
      expect(inspection.restored_per_share).toEqual(expect.any(Number));
      expect(inspection.complete_per_share).toEqual(expect.any(Number));
      expect(Math.abs(inspection.restored_equity_value! - inspection.complete_equity_value!)
        / Math.abs(inspection.complete_equity_value!)).toBeLessThanOrEqual(0.001);
      expect(Math.abs(inspection.restored_per_share! - inspection.complete_per_share!)).toBeLessThanOrEqual(0.01);
      expect(inspection.formula_errors).toEqual([]);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('exports a live incomplete asset-manager workbook when an annual base-fee yield is missing', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-incomplete-blk-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {...process.env, HOME: home, DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite')},
    });

    try {
      const client = new BackendApiClient(await backend.start());
      const completeData = await client.getUnifiedCompany('BLK', 5);
      const incomplete = structuredClone(completeData);
      const missingYear = incomplete.canonical_financials.annual.find((item) => item.year === 2024);
      const baseFeeYield = missingYear?.asset_manager?.base_fee_yield;
      if (!missingYear?.asset_manager || typeof baseFeeYield?.value !== 'number') {
        throw new Error('Live BLK FY2024 base-fee yield is not source-backed for the redaction test.');
      }
      const redacted = {
        ...baseFeeYield,
        source: 'missing' as const,
        value: null,
        method: 'redacted_from_live_payload_for_incomplete_asset_manager_test',
      };
      missingYear.asset_manager.base_fee_yield = redacted;
      incomplete.model_eligibility.status = 'input_required';
      incomplete.model_eligibility.model_route_available = true;
      incomplete.model_eligibility.supported_by_current_engine = false;
      incomplete.model_eligibility.allowed_models = ['asset_manager_aum_dcf'];
      incomplete.model_eligibility.required_input_readiness = {
        ...incomplete.model_eligibility.required_input_readiness,
        three_consecutive_average_aum_base_fee_yields: false,
      };
      incomplete.model_eligibility.missing_input_gaps = [{
        key: 'three_consecutive_average_aum_base_fee_yields',
        label: 'Three filed annual base-fee yields',
        reason: 'A complete three-year base advisory-fee yield series is required for the AUM and fee forecast.',
      }];

      const result = await (async () => {
        try {
          return await runValuationJob('BLK', {
            getUnifiedCompany: async (ticker: string, years: number) => {
              expect(ticker).toBe('BLK');
              expect(years).toBe(5);
              return incomplete;
            },
            exportDcf: (payload: Parameters<typeof client.exportDcf>[0]) => client.exportDcf(payload),
          });
        } catch (error) {
          // Live market/valuation context is sometimes stale or unavailable; the
          // engine must fail closed with exactly this family and write nothing.
          const message = error instanceof Error ? error.message : String(error);
          const failClosed = /Asset-manager DCF requires (a current, non-fallback market snapshot|current risk-free and equity-risk-premium inputs)|A current .* timestamp within 24 hours is required for the asset-manager DCF\./;
          expect(message, 'live BLK redacted run fails closed on market context').toMatch(failClosed);
          const marketStatus = completeData.data_quality?.market?.status;
          const contextStatus = completeData.data_quality?.valuation_context?.status;
          const maxAgeMs = 24 * 60 * 60 * 1000;
          const now = Date.now();
          const marketFresh = typeof completeData.market?.fetched_at_ms === 'number'
            && now - completeData.market.fetched_at_ms <= maxAgeMs;
          const contextFresh = typeof completeData.valuation_context?.fetched_at_ms === 'number'
            && now - completeData.valuation_context.fetched_at_ms <= maxAgeMs;
          const contextReady = ['live', 'cached'].includes(marketStatus)
            && completeData.market?.fallback_used !== true
            && ['live', 'cached'].includes(contextStatus)
            && marketFresh && contextFresh;
          expect(contextReady, 'live BLK market/valuation context is actually stale when the job fails closed').toBe(false);
          return null;
        }
      })();
      if (result === null) return;
      expect(result.status).toBe('input_required');
      expect(result.results).toBeNull();
      expect(result.missingInputs.some((input) => input.key === 'base_fee_yield'
        && input.fiscalYear === 2024 && input.unit === 'ratio' && input.sourceReferenceRequired)).toBe(true);

      const workbookPath = join(home, 'incomplete_blk_dcf.xlsx');
      await writeFile(workbookPath, result.workbookBytes);
      const completeResult = await runValuationJob('BLK', {
        getUnifiedCompany: async () => completeData,
        exportDcf: (payload) => client.exportDcf(payload),
      });
      if (completeResult.status !== 'ready') throw new Error('Live BLK complete model did not reach ready status.');
      const completeWorkbookPath = join(home, 'complete_blk_asset_manager_model.xlsx');
      await writeFile(completeWorkbookPath, completeResult.workbookBytes);
      const feeSource = baseFeeYield.sources[0];
      if (!feeSource?.accession || !feeSource.filed) {
        throw new Error('Live BLK FY2024 base-fee yield has no source reference for workbook restoration.');
      }
      const sourceReference = `${feeSource.concept ?? 'SEC filing'} accession ${feeSource.accession} filed ${feeSource.filed}`;
      const inspection = await inspectIncompleteAssetManagerWorkbook(
        workbookPath,
        baseFeeYield.value,
        sourceReference,
        completeWorkbookPath,
      );
      expect(inspection.sheets).toContain('Asset Manager Model');
      expect(inspection.required_input_row).toBeGreaterThan(0);
      expect(inspection.input_value).toBeNull();
      expect(inspection.input_font_rgb?.slice(-6)).toBe('0000FF');
      expect(inspection.input_locked).toBe(false);
      expect(inspection.source_required).toBe('Yes');
      expect(String(inspection.status_value)).toContain('INCOMPLETE');
      expect(inspection.schedule_input === null || inspection.schedule_input === '').toBe(true);
      expect(String(inspection.schedule_input_formula)).toContain('Input Required');
      expect(inspection.base_fee_yield_assumption === null || inspection.base_fee_yield_assumption === '').toBe(true);
      expect(String(inspection.base_fee_yield_formula)).toContain('AVERAGE(B17:D17)');
      expect(String(inspection.base_fee_yield_formula)).toContain('Input Required');
      expect(inspection.data_review_row).toBeGreaterThan(0);
      expect(inspection.data_review_values?.[4]).toBe('FY2024');
      expect(inspection.data_review_values?.[5]).toBe('ratio');
      expect(inspection.data_review_values?.[7]).toContain(`Input Required!F${inspection.required_input_row}`);
      expect(String(inspection.data_review_values?.[8])).toContain(`'Input Required'!G${inspection.required_input_row}`);
      expect(inspection.data_review_status).toBe('INPUT REQUIRED');
      expect(inspection.guarded_formulas?.E18).toContain('Input Required');
      expect(inspection.guarded_formulas?.B62).toContain('Input Required');
      for (const value of Object.values(inspection.guarded_values ?? {})) {
        expect(value === null || value === '').toBe(true);
      }
      expect(inspection.restored_status).toBe('READY');
      expect(inspection.restored_source_reference).toBe(sourceReference);
      expect(inspection.restored_equity_value).toEqual(expect.any(Number));
      expect(inspection.complete_equity_value).toEqual(expect.any(Number));
      expect(inspection.restored_per_share).toEqual(expect.any(Number));
      expect(inspection.complete_per_share).toEqual(expect.any(Number));
      expect(Math.abs(inspection.restored_equity_value! - inspection.complete_equity_value!)
        / Math.abs(inspection.complete_equity_value!)).toBeLessThanOrEqual(0.001);
      expect(Math.abs(inspection.restored_per_share! - inspection.complete_per_share!)).toBeLessThanOrEqual(0.01);
      expect(inspection.formula_errors).toEqual([]);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('exports a live incomplete telecom workbook when annual postpaid phone churn is missing', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-incomplete-att-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {...process.env, HOME: home, DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite')},
    });

    try {
      const client = new BackendApiClient(await backend.start());
      const completeData = await client.getUnifiedCompany('T', 5);
      const incomplete = structuredClone(completeData);
      const missingYear = incomplete.canonical_financials.annual.find((item) => item.year === 2024);
      const churnLine = missingYear?.telecom?.postpaid_phone_churn;
      if (!missingYear?.telecom || typeof churnLine?.value !== 'number') {
        throw new Error('Live AT&T FY2024 postpaid phone churn is not source-backed for the redaction test.');
      }
      const redacted = {
        ...churnLine,
        source: 'missing' as const,
        value: null,
        method: 'redacted_from_live_payload_for_incomplete_telecom_test',
      };
      missingYear.telecom.postpaid_phone_churn = redacted;
      incomplete.model_eligibility.status = 'input_required';
      incomplete.model_eligibility.model_route_available = true;
      incomplete.model_eligibility.supported_by_current_engine = false;
      incomplete.model_eligibility.allowed_models = ['telecom_subscriber_dcf'];
      incomplete.model_eligibility.required_input_readiness = {
        ...incomplete.model_eligibility.required_input_readiness,
        three_year_postpaid_phone_churn: false,
      };
      incomplete.model_eligibility.missing_input_gaps = [{
        key: 'three_year_postpaid_phone_churn',
        label: 'Three-year filed monthly postpaid phone churn',
        reason: 'The filed monthly postpaid churn series is required for subscriber additions and the revenue forecast.',
      }];

      const result = await runValuationJob('T', {
        getUnifiedCompany: async (ticker: string, years: number) => {
          expect(ticker).toBe('T');
          expect(years).toBe(5);
          return incomplete;
        },
        exportDcf: (payload: Parameters<typeof client.exportDcf>[0]) => client.exportDcf(payload),
      });
      expect(result.status).toBe('input_required');
      expect(result.results).toBeNull();
      expect(result.missingInputs.some((input) => input.key === 'postpaid_phone_churn'
        && input.fiscalYear === 2024 && input.unit === 'ratio' && input.sourceReferenceRequired)).toBe(true);

      const workbookPath = join(home, 'incomplete_att_dcf.xlsx');
      await writeFile(workbookPath, result.workbookBytes);
      const completeResult = await runValuationJob('T', {
        getUnifiedCompany: async () => completeData,
        exportDcf: (payload) => client.exportDcf(payload),
      });
      if (completeResult.status !== 'ready') throw new Error('Live AT&T complete model did not reach ready status.');
      const completeWorkbookPath = join(home, 'complete_att_telecom_model.xlsx');
      await writeFile(completeWorkbookPath, completeResult.workbookBytes);
      const churnSource = churnLine.sources[0];
      if (!churnSource?.accession || !churnSource.filed) {
        throw new Error('Live AT&T FY2024 churn has no source reference for workbook restoration.');
      }
      const sourceReference = `${churnSource.concept ?? 'SEC filing'} accession ${churnSource.accession} filed ${churnSource.filed}`;
      const inspection = await inspectIncompleteTelecomWorkbook(
        workbookPath,
        churnLine.value,
        sourceReference,
        completeWorkbookPath,
      );
      expect(inspection.sheets).toContain('Telecom Model');
      expect(inspection.required_input_row).toBeGreaterThan(0);
      expect(inspection.input_value).toBeNull();
      expect(inspection.input_font_rgb?.slice(-6)).toBe('0000FF');
      expect(inspection.input_locked).toBe(false);
      expect(inspection.source_required).toBe('Yes');
      expect(String(inspection.status_value)).toContain('INCOMPLETE');
      expect(inspection.churn_value === null || inspection.churn_value === '').toBe(true);
      expect(String(inspection.churn_formula)).toContain('Input Required');
      expect(inspection.gross_add_rate === null || inspection.gross_add_rate === '').toBe(true);
      expect(String(inspection.gross_add_rate_formula)).toContain('MEDIAN(C6/C5,D6/D5,E6/E5)');
      expect(inspection.churn_assumption === null || inspection.churn_assumption === '').toBe(true);
      expect(String(inspection.churn_assumption_formula)).toContain('MEDIAN(C7:E7)');
      expect(inspection.data_review_row).toBeGreaterThan(0);
      expect(inspection.data_review_values?.[4]).toBe('FY2024');
      expect(inspection.data_review_values?.[5]).toBe('ratio');
      expect(inspection.data_review_values?.[7]).toContain(`Input Required!F${inspection.required_input_row}`);
      expect(String(inspection.data_review_values?.[8])).toContain(`'Input Required'!G${inspection.required_input_row}`);
      expect(inspection.data_review_status).toBe('INPUT REQUIRED');
      expect(inspection.guarded_formulas?.D8).toContain('Input Required');
      expect(inspection.guarded_formulas?.F10).toContain('Input Required');
      expect(inspection.guarded_formulas?.F22).toContain('Input Required');
      expect(inspection.guarded_formulas?.F65).toContain('Input Required');
      expect(inspection.guarded_formulas?.B83).toContain('Input Required');
      for (const value of Object.values(inspection.guarded_values ?? {})) {
        expect(value === null || value === '').toBe(true);
      }
      expect(inspection.restored_status).toBe('READY');
      expect(inspection.restored_source_reference).toBe(sourceReference);
      expect(inspection.restored_equity_value).toEqual(expect.any(Number));
      expect(inspection.complete_equity_value).toEqual(expect.any(Number));
      expect(inspection.restored_per_share).toEqual(expect.any(Number));
      expect(inspection.complete_per_share).toEqual(expect.any(Number));
      expect(Math.abs(inspection.restored_equity_value! - inspection.complete_equity_value!)
        / Math.abs(inspection.complete_equity_value!)).toBeLessThanOrEqual(0.001);
      expect(Math.abs(inspection.restored_per_share! - inspection.complete_per_share!)).toBeLessThanOrEqual(0.01);
      expect(inspection.formula_errors).toEqual([]);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('exports a live incomplete integrated-energy workbook when crude production is missing', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-incomplete-xom-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {...process.env, HOME: home, DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite')},
    });

    try {
      const client = new BackendApiClient(await backend.start());
      const completeData = await client.getUnifiedCompany('XOM', 5);
      const incomplete = structuredClone(completeData);
      const latest = incomplete.canonical_financials.annual.at(-1);
      const crudeProduction = latest?.energy?.crude_oil_production;
      if (!latest?.energy || typeof crudeProduction?.value !== 'number') {
        throw new Error('Live XOM FY2025 crude production is not source-backed for the redaction test.');
      }
      const redacted = {
        ...crudeProduction,
        source: 'missing' as const,
        value: null,
        method: 'redacted_from_live_payload_for_incomplete_energy_test',
      };
      latest.energy.crude_oil_production = redacted;
      if (incomplete.canonical_financials.latest?.energy) {
        incomplete.canonical_financials.latest.energy.crude_oil_production = redacted;
      }
      incomplete.model_eligibility.status = 'input_required';
      incomplete.model_eligibility.model_route_available = true;
      incomplete.model_eligibility.supported_by_current_engine = false;
      incomplete.model_eligibility.allowed_models = ['integrated_energy_dcf'];
      incomplete.model_eligibility.required_input_readiness = {
        ...incomplete.model_eligibility.required_input_readiness,
        three_year_crude_oil_production: false,
      };
      incomplete.model_eligibility.missing_input_gaps = [{
        key: 'three_year_crude_oil_production',
        label: 'Three-year filed crude production',
        reason: 'Filed crude production is required for upstream revenue, FCFF, and valuation.',
      }];

      const result = await runValuationJob('XOM', {
        getUnifiedCompany: async (ticker: string, years: number) => {
          expect(ticker).toBe('XOM');
          expect(years).toBe(5);
          return incomplete;
        },
        exportDcf: (payload: Parameters<typeof client.exportDcf>[0]) => client.exportDcf(payload),
      });
      expect(result.status).toBe('input_required');
      expect(result.results).toBeNull();
      expect(result.missingInputs.some((input) => input.key === 'crude_oil_production'
        && input.fiscalYear === 2025 && input.unit === 'barrels per day actual' && input.sourceReferenceRequired)).toBe(true);

      const workbookPath = join(home, 'incomplete_xom_dcf.xlsx');
      await writeFile(workbookPath, result.workbookBytes);
      const completeResult = await runValuationJob('XOM', {
        getUnifiedCompany: async () => completeData,
        exportDcf: (payload) => client.exportDcf(payload),
      });
      if (completeResult.status !== 'ready') throw new Error('Live XOM complete model did not reach ready status.');
      const completeWorkbookPath = join(home, 'complete_xom_integrated_energy_model.xlsx');
      await writeFile(completeWorkbookPath, completeResult.workbookBytes);
      const crudeSource = crudeProduction.sources[0];
      if (!crudeSource?.accession || !crudeSource.filed) {
        throw new Error('Live XOM FY2025 crude production has no source reference for workbook restoration.');
      }
      const sourceReference = `${crudeSource.concept ?? 'SEC filing'} accession ${crudeSource.accession} filed ${crudeSource.filed}`;
      const inspection = await inspectIncompleteIntegratedEnergyWorkbook(
        workbookPath,
        crudeProduction.value,
        sourceReference,
        completeWorkbookPath,
      );
      expect(inspection.sheets).toContain('Integrated Energy Model');
      expect(inspection.required_input_row).toBeGreaterThan(0);
      expect(inspection.input_value).toBeNull();
      expect(inspection.input_font_rgb?.slice(-6)).toBe('0000FF');
      expect(inspection.input_locked).toBe(false);
      expect(inspection.source_required).toBe('Yes');
      expect(String(inspection.status_value)).toContain('INCOMPLETE');
      expect(inspection.production_value === null || inspection.production_value === '').toBe(true);
      expect(inspection.production_revenue === null || inspection.production_revenue === '').toBe(true);
      expect(inspection.production_margin === null || inspection.production_margin === '').toBe(true);
      expect(String(inspection.production_formula)).toContain('Input Required');
      expect(inspection.conversion_factor === null || inspection.conversion_factor === '').toBe(true);
      expect(String(inspection.conversion_factor_formula)).toContain('Input Required');
      expect(inspection.data_review_row).toBeGreaterThan(0);
      expect(inspection.data_review_values?.[4]).toBe('FY2025');
      expect(inspection.data_review_values?.[5]).toBe('barrels per day actual');
      expect(inspection.data_review_values?.[7]).toContain(`Input Required!F${inspection.required_input_row}`);
      expect(String(inspection.data_review_values?.[8])).toContain(`'Input Required'!G${inspection.required_input_row}`);
      expect(inspection.data_review_status).toBe('INPUT REQUIRED');
      expect(inspection.guarded_formulas?.D22).toContain('Input Required');
      expect(inspection.guarded_formulas?.E66).toContain('Input Required');
      expect(inspection.guarded_formulas?.E79).toContain('Input Required');
      expect(inspection.guarded_formulas?.B95).toContain('Input Required');
      for (const value of Object.values(inspection.guarded_values ?? {})) {
        expect(value === null || value === '').toBe(true);
      }
      expect(inspection.restored_status).toBe('READY');
      expect(inspection.restored_source_reference).toBe(sourceReference);
      expect(inspection.restored_equity_value).toEqual(expect.any(Number));
      expect(inspection.complete_equity_value).toEqual(expect.any(Number));
      expect(inspection.restored_per_share).toEqual(expect.any(Number));
      expect(inspection.complete_per_share).toEqual(expect.any(Number));
      expect(Math.abs(inspection.restored_equity_value! - inspection.complete_equity_value!)
        / Math.abs(inspection.complete_equity_value!)).toBeLessThanOrEqual(0.001);
      expect(Math.abs(inspection.restored_per_share! - inspection.complete_per_share!)).toBeLessThanOrEqual(0.01);
      expect(inspection.formula_errors).toEqual([]);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('exports a live incomplete mature-pharma workbook when one filed product sale is missing', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-incomplete-pfe-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {...process.env, HOME: home, DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite')},
    });

    try {
      const client = new BackendApiClient(await backend.start());
      const completeData = await client.getUnifiedCompany('PFE', 5);
      const incomplete = structuredClone(completeData);
      const missingYear = incomplete.canonical_financials.annual.find((item) => item.year === 2024);
      const product = missingYear?.pharma?.products.find((item) => item.product_name === 'Eliquis (a)');
      if (!missingYear?.pharma || typeof product?.revenue.value !== 'number') {
        throw new Error('Live PFE FY2024 Eliquis revenue is not source-backed for the redaction test.');
      }
      const originalProductRevenue = product.revenue.value;
      const redacted = {
        ...product.revenue,
        source: 'missing' as const,
        value: null,
        method: 'redacted_from_live_payload_for_incomplete_pharma_test',
      };
      product.revenue = redacted;
      incomplete.model_eligibility.status = 'input_required';
      incomplete.model_eligibility.model_route_available = true;
      incomplete.model_eligibility.supported_by_current_engine = false;
      incomplete.model_eligibility.allowed_models = ['mature_pharma_product_dcf'];
      incomplete.model_eligibility.required_input_readiness = {
        ...incomplete.model_eligibility.required_input_readiness,
        three_year_filed_product_sales: false,
      };
      incomplete.model_eligibility.missing_input_gaps = [{
        key: 'three_year_filed_product_sales',
        label: 'Three-year filed product sales',
        reason: 'Product-level sales history is required for the product-by-product growth and LOE schedule.',
      }];

      const result = await runValuationJob('PFE', {
        getUnifiedCompany: async (ticker: string, years: number) => {
          expect(ticker).toBe('PFE');
          expect(years).toBe(5);
          return incomplete;
        },
        exportDcf: (payload: Parameters<typeof client.exportDcf>[0]) => client.exportDcf(payload),
      });
      expect(result.status).toBe('input_required');
      expect(result.results).toBeNull();
      expect(result.missingInputs.some((input) => input.key === 'product_revenue:eliquis_a'
        && input.fiscalYear === 2024 && input.unit === 'USD actual' && input.sourceReferenceRequired)).toBe(true);

      const workbookPath = join(home, 'incomplete_pfe_dcf.xlsx');
      await writeFile(workbookPath, result.workbookBytes);
      const completeResult = await runValuationJob('PFE', {
        getUnifiedCompany: async () => completeData,
        exportDcf: (payload) => client.exportDcf(payload),
      });
      if (completeResult.status !== 'ready') throw new Error('Live PFE complete model did not reach ready status.');
      const completeWorkbookPath = join(home, 'complete_pfe_pharma_model.xlsx');
      await writeFile(completeWorkbookPath, completeResult.workbookBytes);
      const productSource = product.revenue.sources[0];
      if (!productSource?.accession || !productSource.filed) {
        throw new Error('Live PFE FY2024 Eliquis sales have no SEC source reference for workbook restoration.');
      }
      const sourceReference = `${productSource.concept ?? 'SEC filing'} accession ${productSource.accession} filed ${productSource.filed}`;
      const inspection = await inspectIncompleteMaturePharmaWorkbook(
        workbookPath,
        originalProductRevenue,
        sourceReference,
        completeWorkbookPath,
      );
      expect(inspection.sheets).toContain('Mature Pharma Model');
      expect(inspection.required_input_row).toBeGreaterThan(0);
      expect(inspection.input_value).toBeNull();
      expect(inspection.input_font_rgb?.slice(-6)).toBe('0000FF');
      expect(inspection.input_locked).toBe(false);
      expect(inspection.source_required).toBe('Yes');
      expect(String(inspection.status_value)).toContain('INCOMPLETE');
      expect(inspection.product_row).toBeGreaterThan(0);
      expect(inspection.product_revenue === null || inspection.product_revenue === '').toBe(true);
      expect(String(inspection.product_revenue_formula)).toContain('Input Required');
      expect(inspection.product_growth === null || inspection.product_growth === '').toBe(true);
      expect(String(inspection.product_growth_formula)).toContain('Input Required');
      expect(inspection.patent_years).toEqual([2027, 2026, 2026, 2027]);
      expect(inspection.data_review_row).toBeGreaterThan(0);
      expect(inspection.data_review_values?.[4]).toBe('FY2024');
      expect(inspection.data_review_values?.[5]).toBe('USD actual');
      expect(inspection.data_review_values?.[7]).toContain(`Input Required!F${inspection.required_input_row}`);
      expect(String(inspection.data_review_values?.[8])).toContain(`'Input Required'!G${inspection.required_input_row}`);
      expect(inspection.data_review_status).toBe('INPUT REQUIRED');
      expect(String(inspection.guarded_formulas?.F_fcff)).toContain('Input Required');
      expect(String(inspection.guarded_formulas?.B_equity_value)).toContain('Input Required');
      expect(String(inspection.guarded_formulas?.C_sensitivity)).toContain('Input Required');
      for (const value of Object.values(inspection.guarded_values ?? {})) {
        expect(value === null || value === '').toBe(true);
      }
      expect(inspection.restored_status).toBe('READY');
      expect(inspection.restored_source_reference).toBe(sourceReference);
      expect(inspection.restored_equity_value).toEqual(expect.any(Number));
      expect(inspection.complete_equity_value).toEqual(expect.any(Number));
      expect(inspection.restored_per_share).toEqual(expect.any(Number));
      expect(inspection.complete_per_share).toEqual(expect.any(Number));
      expect(Math.abs(inspection.restored_equity_value! - inspection.complete_equity_value!)
        / Math.abs(inspection.complete_equity_value!)).toBeLessThanOrEqual(0.001);
      expect(Math.abs(inspection.restored_per_share! - inspection.complete_per_share!)).toBeLessThanOrEqual(0.01);
      expect(inspection.formula_errors).toEqual([]);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('exports incomplete rate-base workbooks for filing-derived regulated DUK and NEE', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-utility-readiness-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {...process.env, HOME: home, DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite')},
    });
    try {
      const client = new BackendApiClient(await backend.start());
      const duk = await client.getUnifiedCompany('DUK', 5);
      expect(duk.model_eligibility.subtype).toBe('regulated_utility');
      expect(duk.model_eligibility.supported_by_current_engine).toBe(false);
      expect(duk.model_eligibility.status).toBe('input_required');
      expect(duk.model_eligibility.model_route_available).toBe(true);
      expect(duk.model_eligibility.allowed_models).toEqual(['utility_dcf']);
      expect(duk.model_eligibility.required_input_readiness?.jurisdictional_rate_base).toBe(false);
      expect(duk.model_eligibility.required_input_readiness?.authorized_return_on_equity).toBe(false);
      const result = await runValuationJob('DUK', client);
      expect(result.status).toBe('input_required');
      expect(result.results).toBeNull();
      expect(result.missingInputs.some((input) => input.key === 'jurisdictional_rate_base')).toBe(true);
      expect(result.missingInputs.some((input) => input.key === 'allowed_roe')).toBe(true);
      if (result.status !== 'input_required' || !result.exportPayload.utilityModel) {
        throw new Error('DUK did not produce an input-required utility DDM payload.');
      }
      const utility = result.exportPayload.utilityModel;
      const requireMarketValue = (value: number | null | undefined, field: string): number => {
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
          throw new Error(`Live DUK utility workbook requires current ${field}.`);
        }
        return value;
      };
      const utilityScenario = {
        base_year: utility.baseYear,
        base_rate_base: 100_000_000_000,
        authorized_roe: 0.095,
        authorized_equity_ratio: 0.5,
        rate_base_additions: Array.from({length: 5}, () => 8_000_000_000),
        rate_base_depreciation: Array.from({length: 5}, () => 3_000_000_000),
        dividend_payout_ratio: 0.65,
        terminal_growth_rate: 0.025,
        source_reference: 'Test scenario: live DUK utility input workbook',
      };
      const engine = calculateUtilityValuation({
        baseYear: utility.baseYear,
        baseRateBase: utilityScenario.base_rate_base,
        authorizedEquityRatio: utilityScenario.authorized_equity_ratio,
        allowedRoe: utilityScenario.authorized_roe,
        rateBaseAdditions: utilityScenario.rate_base_additions,
        rateBaseDepreciation: utilityScenario.rate_base_depreciation,
        dividendPayoutRatio: utilityScenario.dividend_payout_ratio,
        riskFreeRate: requireMarketValue(utility.riskFreeRate, 'risk-free rate'),
        equityRiskPremium: requireMarketValue(utility.equityRiskPremium, 'equity-risk premium'),
        beta: requireMarketValue(utility.beta, 'beta'),
        terminalGrowthRate: utilityScenario.terminal_growth_rate,
        currentPrice: requireMarketValue(utility.currentPrice, 'share price'),
        dilutedShares: requireMarketValue(utility.dilutedShares, 'diluted shares'),
      });
      const utilityWorkbookPath = join(home, 'duk_utility_incomplete.xlsx');
      await writeFile(utilityWorkbookPath, result.workbookBytes);
      const inspection = await inspectIncompleteUtilityWorkbook(utilityWorkbookPath, utilityScenario);
      expect(inspection.sheets).toEqual(['Utility Model', 'Input Required', 'Data Review']);
      expect(inspection.formula_count).toBeGreaterThan(90);
      expect(inspection.formula_errors).toEqual([]);
      expect(inspection.model_sheet_protected).toBe(false);
      expect(inspection.input_sheet_protected).toBe(false);
      expect(inspection.required_input_count).toBe(15);
      expect(inspection.required_source_count).toBe(8);
      expect(inspection.input_value_blank).toBe(true);
      expect(inspection.input_blue?.slice(-6)).toBe('0000FF');
      expect(inspection.input_locked).toBe(false);
      expect(String(inspection.status_formula)).toContain('READY');
      expect(inspection.incomplete_status).toBe('INCOMPLETE — fill required inputs');
      expect(inspection.incomplete_outputs.every((value) => value === null || value === '')).toBe(true);
      expect(String(inspection.formula_cells.B24)).toContain('J5');
      expect(String(inspection.formula_cells.B24)).toContain('J7');
      expect(String(inspection.formula_cells.B29)).toContain('READY');
      expect(inspection.restored_status).toBe('READY');
      expect(inspection.restored_review_status).toBe('READY');
      expect(typeof inspection.restored_equity_value_millions, JSON.stringify(inspection.restored_model_values)).toBe('number');
      expect(typeof inspection.restored_per_share, JSON.stringify(inspection.restored_model_values)).toBe('number');
      expect(inspection.restored_sensitivity_center).toBeCloseTo(inspection.restored_per_share ?? 0, 2);
      expect(inspection.invalid_status).toBe('INPUT ERROR — check required inputs');
      expect(inspection.invalid_outputs.every((value) => value === null || value === '')).toBe(true);
      expect(Number(inspection.higher_equity_value_millions)).toBeGreaterThan(Number(inspection.restored_equity_value_millions));
      expect(Math.abs(Number(inspection.restored_equity_value_millions) * 1_000_000 - engine.equityValue)
        / engine.equityValue).toBeLessThanOrEqual(0.001);
      expect(Math.abs(Number(inspection.restored_per_share) - engine.impliedSharePrice)).toBeLessThanOrEqual(0.01);
      const nee = await client.getUnifiedCompany('NEE', 5);
      expect(nee.model_eligibility.subtype).toBe('regulated_utility');
      expect(nee.model_eligibility.status).toBe('input_required');
      expect(nee.model_eligibility.supported_by_current_engine).toBe(false);
      expect(nee.model_eligibility.required_input_readiness?.regulated_and_unregulated_segments_separated).toBe(true);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('maps commercial bank drivers from JPM and BAC SEC filings', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-bank-canonical-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });

    try {
      const client = new BackendApiClient(await backend.start());
      const latestExpected: Record<string, Record<string, number>> = {
        JPM: {
          interest_income: 193_341_000_000,
          interest_expense: 97_898_000_000,
          net_interest_income: 95_443_000_000,
          noninterest_income: 87_004_000_000,
          noninterest_expense: 95_640_000_000,
          provision_for_credit_losses: 14_212_000_000,
          loans_and_leases: 1_467_664_000_000,
          deposits: 2_559_320_000_000,
          interest_bearing_liabilities: 3_163_933_000_000,
          interest_earning_assets: 3_834_359_000_000,
          risk_weighted_assets: 1_981_692_000_000,
          cet1_capital: 288_469_000_000,
          minimum_cet1_ratio: 0.115,
          common_equity: 342_393_000_000,
          common_equity_distributions: 48_216_000_000,
          diluted_shares: 2_781_500_000,
        },
        BAC: {
          interest_income: 138_566_000_000,
          interest_expense: 78_470_000_000,
          net_interest_income: 60_096_000_000,
          noninterest_income: 53_001_000_000,
          noninterest_expense: 69_727_000_000,
          provision_for_credit_losses: 5_675_000_000,
          loans_and_leases: 1_172_497_000_000,
          deposits: 2_018_729_000_000,
          interest_bearing_liabilities: 2_329_106_000_000,
          interest_earning_assets: 3_024_272_000_000,
          risk_weighted_assets: 1_773_000_000_000,
          cet1_capital: 201_410_000_000,
          minimum_cet1_ratio: 0.10,
          common_equity_distributions: 29_516_000_000,
          diluted_shares: 7_680_900_000,
        },
      };
      const priorBankExpected: Record<string, Record<string, Record<string, number>>> = {
        JPM: {
          '2023': {noninterest_income: 68_837_000_000, noninterest_expense: 87_172_000_000, provision_for_credit_losses: 9_320_000_000},
          '2024': {noninterest_income: 84_973_000_000, noninterest_expense: 91_797_000_000, provision_for_credit_losses: 10_678_000_000},
        },
        BAC: {
          '2023': {noninterest_income: 45_838_000_000, noninterest_expense: 65_845_000_000, provision_for_credit_losses: 4_394_000_000},
          '2024': {noninterest_income: 49_796_000_000, noninterest_expense: 66_812_000_000, provision_for_credit_losses: 5_821_000_000},
        },
      };
      for (const ticker of ['JPM', 'BAC']) {
        const payload = await client.getUnifiedCompany(ticker, 5);
        const canonical = payload.canonical_financials as unknown as {
          years: number[];
          annual: Array<{year: number; bank?: Record<string, {
            value: number | null;
            source: string;
            method: string;
            concept: string | null;
            sources: Array<{
              concept: string | null;
              reported_value: number | null;
              fiscal_period: string | null;
              accession: string | null;
              filed: string | null;
              currency: string | null;
              unit: string | null;
              unit_scale: string | null;
            }>;
          }>}>;
        };
        const latest = canonical.annual.at(-1);
        const bank = latest?.bank;
        expect(payload.model_eligibility.subtype, `${ticker} is classified as a commercial bank`)
          .toBe('commercial_bank');
        for (const field of [
          'interest_income', 'interest_expense', 'net_interest_income',
          'noninterest_income', 'noninterest_expense', 'provision_for_credit_losses',
          'loans_and_leases', 'deposits', 'interest_bearing_liabilities',
          'interest_earning_assets', 'risk_weighted_assets', 'cet1_capital', 'minimum_cet1_ratio',
          'common_equity', 'diluted_shares',
        ]) {
          expect(payload.model_eligibility.required_input_readiness?.[field], `${ticker} readiness ${field}`)
            .toBe(true);
        }
        // common_equity_distributions is a composite line: derive its expected
        // readiness from the live canonical line only (finite value,
        // sec_native/derived source, complete accession/filed provenance).
        const distributionsLine = bank?.common_equity_distributions;
        const distributionsSources = Array.isArray(distributionsLine?.sources) ? distributionsLine.sources : [];
        const distributionsReady = typeof distributionsLine?.value === 'number'
          && Number.isFinite(distributionsLine.value)
          && (distributionsLine.source === 'sec_native' || distributionsLine.source === 'derived')
          && distributionsSources.length > 0
          && distributionsSources.every((source) => Boolean(source?.accession) && Boolean(source?.filed));
        expect(
          payload.model_eligibility.required_input_readiness?.common_equity_distributions,
          `${ticker} readiness common_equity_distributions follows the live canonical line`,
        ).toBe(distributionsReady);
        const readiness = payload.model_eligibility.required_input_readiness ?? {};
        const notReadyInputs = Object.entries(readiness)
          .filter(([, ready]) => !ready)
          .map(([field]) => field);
        const liveRateInputs = new Set(['live_risk_free_rate', 'live_equity_risk_premium']);
        const toleratedInputs = new Set([
          ...liveRateInputs,
          ...(!distributionsReady ? ['common_equity_distributions'] : []),
        ]);
        const notReadyBankInputs = notReadyInputs.filter((field) => !toleratedInputs.has(field));
        expect(notReadyBankInputs, `${ticker} filed and market identity inputs`).toEqual([]);
        const liveRatesReady = [...liveRateInputs].every((field) => readiness[field] === true);
        expect(payload.model_eligibility.supported_by_current_engine, `${ticker} model eligibility`)
          .toBe(liveRatesReady);
        if (liveRatesReady) {
          expect(payload.model_eligibility.allowed_models).toContain('bank_residual_income');
        } else {
          const bankBlock = payload.model_eligibility.blocked_models.find((item) => item.model === 'bank_residual_income');
          expect(bankBlock, `${ticker} fails closed when live rates are missing`).toBeDefined();
          for (const field of notReadyInputs.filter((item) => liveRateInputs.has(item))) {
            expect(bankBlock?.reason).toContain(field);
          }
        }
        expect(bank, `${ticker} has a dedicated commercial-bank history`).toBeDefined();
        expect(latest?.year, `${ticker} bank year matches canonical fiscal history`)
          .toBe(canonical.years.at(-1));

        for (const field of [
          'interest_income', 'interest_expense', 'net_interest_income',
          'noninterest_income', 'noninterest_expense', 'provision_for_credit_losses',
          'loans_and_leases', 'deposits', 'interest_bearing_liabilities',
          'interest_earning_assets', 'risk_weighted_assets', 'cet1_capital', 'minimum_cet1_ratio',
          'common_equity', 'common_equity_distributions', 'diluted_shares',
        ]) {
          const line = bank?.[field];
          expect(line, `${ticker} ${field} canonical line`).toBeDefined();
          if (field === 'common_equity_distributions' && !distributionsReady) {
            // Missing composite: never presented as a sourced zero, and the
            // eligibility readiness above already reflects it as not ready.
            const presentedAsSourcedZero = line?.value === 0
              && (line?.source === 'sec_native' || line?.source === 'derived');
            expect(presentedAsSourcedZero, `${ticker} ${field} is not a sourced zero`).toBe(false);
            continue;
          }
          expect(line?.value, `${ticker} ${field} is source-backed`).toEqual(expect.any(Number));
          if (latest?.year === 2025 && latestExpected[ticker][field] !== undefined) {
            expect(line?.value, `${ticker} FY2025 ${field} matches its live filing row or source facts`)
              .toBe(latestExpected[ticker][field]);
          }
          expect(['sec_native', 'derived']).toContain(line?.source);
          expect(line?.sources.length, `${ticker} ${field} keeps filing provenance`).toBeGreaterThan(0);
          for (const source of line?.sources ?? []) {
            expect(source.fiscal_period).toBe(`FY ${latest?.year}`);
            expect(source.accession, `${ticker} ${field} ${source.concept ?? 'unknown concept'} source accession`)
              .toEqual(expect.stringMatching(/^\d{10}-\d{2}-\d{6}$/));
            expect(source.filed, `${ticker} ${field} source filed date`)
              .toEqual(expect.stringMatching(/^20\d{2}-\d{2}-\d{2}$/));
            if (field === 'minimum_cet1_ratio') {
              expect(source.currency).toBeNull();
              expect(source.unit).toBe('percent');
              expect(source.unit_scale).toBe('percent');
            } else if (field === 'diluted_shares') {
              expect(source.currency).toBeNull();
              expect(source.unit).toBe('shares');
              expect(source.unit_scale).toBe('actual');
            } else {
              expect(source.currency).toBe('USD');
              expect(source.unit).toBe('USD');
              expect(['actual', 'millions', 'billions']).toContain(source.unit_scale);
            }
          }
        }

        for (const year of [2023, 2024]) {
          const historicalYear = canonical.annual.find((item) => item.year === year);
          for (const [field, expectedValue] of Object.entries(priorBankExpected[ticker][String(year)])) {
            const line = historicalYear?.bank?.[field];
            expect(line?.value, `${ticker} FY${year} ${field} from 2025 10-K comparative table`)
              .toBe(expectedValue);
            expect(line?.source).toBe('sec_native');
            expect(line?.sources.some((source) => source.accession && source.filed && source.fiscal_period === `FY ${year}`))
              .toBe(true);
          }
        }
      }

      const goldman = await client.getUnifiedCompany('GS', 5);
      expect(goldman.model_eligibility.subtype).toBe('investment_bank');
      expect(goldman.model_eligibility.supported_by_current_engine).toBe(false);
      expect(goldman.model_eligibility.blocked_models[0]?.reason)
        .toContain('Investment-bank valuation is unsupported');
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('calculates a sourced five-year bank forecast and residual-income valuation', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-bank-valuation-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });

    try {
      const payload = await new BackendApiClient(await backend.start()).getUnifiedCompany('JPM', 5);
      const historical = mapCanonicalBankFinancialsToHistoricals(payload.canonical_financials);
      const latest = historical.annual.at(-1);
      if (!latest) throw new Error('JPM live bank history is unavailable.');
      expect(latest?.year).toBe(payload.canonical_financials.years.at(-1));
      expect(latest?.bank.interest_earning_assets.value).toEqual(expect.any(Number));
      expect(latest?.bank.interest_bearing_liabilities.value).toEqual(expect.any(Number));
      expect(latest?.bank.common_equity.value).toEqual(expect.any(Number));

      const interestIncome = Number(latest?.bank.interest_income.value);
      const interestExpense = Number(latest?.bank.interest_expense.value);
      const earningAssets = Number(latest?.bank.interest_earning_assets.value);
      const interestBearingLiabilities = Number(latest?.bank.interest_bearing_liabilities.value);
      const netInterestIncome = Number(latest?.bank.net_interest_income.value);
      const noninterestIncome = Number(latest?.bank.noninterest_income.value);
      const noninterestExpense = Number(latest?.bank.noninterest_expense.value);
      const loans = Number(latest?.bank.loans_and_leases.value);
      const provision = Number(latest?.bank.provision_for_credit_losses.value);
      const minimumCet1Ratio = Number(latest.bank.minimum_cet1_ratio.value);
      const minimumCet1Source = latest.bank.minimum_cet1_ratio.sources[0];
      const taxRate = Number(payload.canonical_financials.latest?.tax_rate.value);
      const riskFreeRate = payload.valuation_context.risk_free_rate;
      const equityRiskPremium = payload.valuation_context.equity_risk_premium;
      const beta = payload.market.beta;
      const currentPrice = payload.market.current_price;
      const dilutedShares = payload.market.shares_outstanding ?? latest?.bank.diluted_shares.value;

      expect(payload.data_quality.market.status).toBe('live');
      expect(payload.data_quality.valuation_context.status).toBe('live');
      expect(riskFreeRate).toEqual(expect.any(Number));
      expect(equityRiskPremium).toEqual(expect.any(Number));
      expect(beta).toEqual(expect.any(Number));
      expect(currentPrice).toEqual(expect.any(Number));
      expect(dilutedShares).toEqual(expect.any(Number));

      const assumptions = {
        forecastYears: 5,
        earningAssetGrowth: 0.04,
        loanGrowth: 0.04,
        depositGrowth: 0.03,
        earningAssetYield: interestIncome / earningAssets,
        fundingCost: interestExpense / interestBearingLiabilities,
        noninterestIncomeGrowth: 0.03,
        efficiencyRatio: noninterestExpense / (netInterestIncome + noninterestIncome),
        provisionRate: provision / loans,
        taxRate,
        payoutRatio: 0.65,
        minimumCet1Ratio,
        minimumCet1RatioSource: `${minimumCet1Source?.concept} accession ${minimumCet1Source?.accession} filed ${minimumCet1Source?.filed}`,
        riskFreeRate: Number(riskFreeRate),
        riskFreeRateSource: String(payload.valuation_context.treasury_rate_source),
        equityRiskPremium: Number(equityRiskPremium),
        equityRiskPremiumSource: String(payload.valuation_context.erp_source),
        beta: Number(beta),
        betaSource: String(payload.market.source),
        marketDataAsOfDate: String(payload.valuation_context.as_of_date),
        terminalGrowthRate: 0.025,
        currentPrice: Number(currentPrice),
        dilutedSharesOutstanding: Number(dilutedShares),
        assumptionSources: {
          earningAssetGrowth: 'Analyst live-test scenario input: 4.0%',
          loanGrowth: 'Analyst live-test scenario input: 4.0%',
          depositGrowth: 'Analyst live-test scenario input: 3.0%',
          earningAssetYield: `FY${latest?.year} filed interest income divided by average earning assets`,
          fundingCost: `FY${latest?.year} filed interest expense divided by average interest-bearing liabilities`,
          noninterestIncomeGrowth: 'Analyst live-test scenario input: 3.0%',
          efficiencyRatio: `FY${latest?.year} filed noninterest expense divided by total revenue`,
          provisionRate: `FY${latest?.year} filed credit provision divided by loans`,
          taxRate: `FY${latest?.year} filed effective tax rate`,
          payoutRatio: 'Analyst live-test scenario input: 65.0%',
          terminalGrowthRate: 'Analyst live-test scenario input: 2.5%',
        },
      };
      const result = calculateBankValuation(historical, assumptions);
      expect(result.valuationBasis).toBe('equity');
      expect(result.enterpriseValue).toBeNull();
      expect(result.bankForecasts).toHaveLength(5);
      expect(result.equityValue).toBeGreaterThan(0);
      expect(result.impliedSharePrice).toBeGreaterThan(0);
      for (const forecast of result.bankForecasts) {
        expect(forecast.interestIncome - forecast.interestExpense).toBeCloseTo(forecast.netInterestIncome, 6);
        expect(forecast.netInterestIncome + forecast.noninterestIncome).toBeCloseTo(forecast.totalRevenue, 6);
        expect(forecast.totalRevenue - forecast.noninterestExpense - forecast.provisionForCreditLosses)
          .toBeCloseTo(forecast.pretaxIncome, 6);
        expect(forecast.pretaxIncome - forecast.taxExpense).toBeCloseTo(forecast.netIncome, 6);
        expect(forecast.openingCommonEquity + forecast.netIncome - forecast.commonDistributions)
          .toBeCloseTo(forecast.endingCommonEquity, 6);
        expect(forecast.endingCet1Capital / forecast.endingRiskWeightedAssets)
          .toBeGreaterThanOrEqual(assumptions.minimumCet1Ratio - 1e-9);
        expect(forecast.residualIncome).toBeCloseTo(forecast.netIncome - result.costOfEquity * forecast.openingCommonEquity, 6);
      }

      const higherCostOfEquity = calculateBankValuation(historical, {
        ...assumptions,
        riskFreeRate: assumptions.riskFreeRate + 0.005,
      });
      const higherAssetYield = calculateBankValuation(historical, {
        ...assumptions,
        earningAssetYield: assumptions.earningAssetYield + 0.0025,
      });
      expect(higherCostOfEquity.equityValue).toBeLessThan(result.equityValue);
      expect(higherAssetYield.equityValue).toBeGreaterThan(result.equityValue);
    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('exports an editable formula bank workbook for JPM', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-bank-export-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });

    try {
      const client = new BackendApiClient(await backend.start());
      const data = await client.getUnifiedCompany('JPM', 5);
      const historical = mapCanonicalBankFinancialsToHistoricals(data.canonical_financials);
      const latest = historical.annual.at(-1);
      if (!latest) throw new Error('JPM live bank history is unavailable.');
      const value = (field: keyof typeof latest.bank): number => {
        const amount = latest.bank[field].value;
        if (typeof amount !== 'number' || !Number.isFinite(amount)) {
          throw new Error(`JPM FY${latest.year} ${field} is unavailable.`);
        }
        return amount;
      };
      const taxRate = data.canonical_financials.latest?.tax_rate.value;
      const riskFreeRate = data.valuation_context.risk_free_rate;
      const equityRiskPremium = data.valuation_context.equity_risk_premium;
      const beta = data.market.beta;
      const currentPrice = data.market.current_price;
      const shares = data.market.shares_outstanding ?? value('diluted_shares');
      const minimumCet1Source = latest.bank.minimum_cet1_ratio.sources[0];
      if ([taxRate, riskFreeRate, equityRiskPremium, beta, currentPrice, shares].some((amount) => typeof amount !== 'number')) {
        throw new Error('JPM live tax, valuation, or market inputs are incomplete.');
      }
      const assumptions: BankModelAssumptions = {
        forecastYears: 5,
        earningAssetGrowth: 0.04,
        loanGrowth: 0.04,
        depositGrowth: 0.03,
        earningAssetYield: value('interest_income') / value('interest_earning_assets'),
        fundingCost: value('interest_expense') / value('interest_bearing_liabilities'),
        noninterestIncomeGrowth: 0.03,
        efficiencyRatio: value('noninterest_expense') / (value('net_interest_income') + value('noninterest_income')),
        provisionRate: value('provision_for_credit_losses') / value('loans_and_leases'),
        taxRate,
        payoutRatio: 0.65,
        minimumCet1Ratio: value('minimum_cet1_ratio'),
        minimumCet1RatioSource: `${minimumCet1Source?.concept} accession ${minimumCet1Source?.accession} filed ${minimumCet1Source?.filed}`,
        riskFreeRate,
        riskFreeRateSource: String(data.valuation_context.treasury_rate_source),
        equityRiskPremium,
        equityRiskPremiumSource: String(data.valuation_context.erp_source),
        beta,
        betaSource: String(data.market.source),
        marketDataAsOfDate: String(data.valuation_context.as_of_date),
        terminalGrowthRate: 0.025,
        currentPrice,
        dilutedSharesOutstanding: shares,
        assumptionSources: {
          earningAssetGrowth: 'Analyst live-test scenario input: 4.0%',
          loanGrowth: 'Analyst live-test scenario input: 4.0%',
          depositGrowth: 'Analyst live-test scenario input: 3.0%',
          earningAssetYield: `FY${latest.year} filed interest income divided by average earning assets`,
          fundingCost: `FY${latest.year} filed interest expense divided by average interest-bearing liabilities`,
          noninterestIncomeGrowth: 'Analyst live-test scenario input: 3.0%',
          efficiencyRatio: `FY${latest.year} filed noninterest expense divided by total revenue`,
          provisionRate: `FY${latest.year} filed credit provision divided by loans`,
          taxRate: `FY${latest.year} filed effective tax rate`,
          payoutRatio: 'Analyst live-test scenario input: 65.0%',
          terminalGrowthRate: 'Analyst live-test scenario input: 2.5%',
        },
      };
      const engineResult = calculateBankValuation(historical, assumptions);
      expect(engineResult.valuationBasis).toBe('equity');
      expect(engineResult.equityValue).toBeGreaterThan(0);
      const profile = mapNativeProfile(data.profile, data.financials_native, data.market);
      const payload = buildBankModelExportPayload(profile, historical, assumptions);
      const outputPath = join(home, 'jpm_bank_model.xlsx');
      const workbookBytes = await client.exportDcf(payload);
      await writeFile(outputPath, workbookBytes);

      const workbook = await inspectWorkbook(outputPath, {
        ticker: 'JPM',
        modelSheet: 'Bank Model',
        inputCell: 'B23',
        editableCells: ['B23', 'B24', 'B25', 'B26', 'B27', 'B28', 'B29', 'B30', 'B31', 'B32', 'B33', 'B34', 'B35', 'B36', 'B38'],
        formulaCells: ['B37', 'C44', 'C48', 'C50', 'C53', 'C55', 'C66', 'C71', 'C72', 'B77', 'B78', 'B80', 'C86', 'B89', 'E89', 'H89', 'I89'],
      });
      expect(workbook.sheets).toEqual(['Bank Model', 'Data Review']);
      expect(workbook.model_title).toContain('JPM');
      expect(workbook.formula_count).toBeGreaterThan(40);
      expect(workbook.formula_refs).toEqual([]);
      expect(workbook.input_is_formula).toBe(false);
      expect(workbook.input_font_rgb?.slice(-6)).toBe('0000FF');
      expect(workbook.editable_cells).toHaveProperty('B23');
      for (const [cell, detail] of Object.entries(workbook.editable_cells)) {
        expect(detail.is_formula, `${cell} is an editable input`).toBe(false);
        expect(detail.font_rgb?.slice(-6), `${cell} is styled as an input`).toBe('0000FF');
      }
      expect(workbook.formula_cells.C44).toBe('=$B$14*(1+$B$23)');
      expect(workbook.formula_cells.C48).toBe('=C44*$B$26');
      expect(workbook.formula_cells.C50).toBe('=C48-C49');
      expect(workbook.formula_cells.C53).toBe('=C52*$B$29');
      expect(workbook.formula_cells.C66).toBe('=MIN(C60,C65)');
      expect(workbook.formula_cells.C71).toBe('=C58-C70');
      expect(workbook.formula_cells.B37).toBe('=B34+B35*B36');
      expect(String(workbook.formula_cells.B77)).toContain('$B$17');
      expect(String(workbook.formula_cells.B77)).toContain('$B$74');
      expect(String(workbook.formula_cells.B77)).toContain('$B$76');
      expect(String(workbook.formula_cells.B78)).toContain('$B$40');
      expect(String(workbook.formula_cells.B80)).toContain('$B$79');
      expect(workbook.formula_cells.C86).toBe('=$B$38-1%');
      expect(workbook.formula_cells.B89).toBe('=$B$37');
      expect(String(workbook.formula_cells.E89)).toContain('$H89');
      expect(String(workbook.formula_cells.E89)).toContain('$I89');
      expect(String(workbook.formula_cells.E89)).toContain('E$86');
      expect(workbook.review_notes.some((note) =>
        note.includes('BankRiskWeightedAssets')
        && note.includes('0001628280-26-008131')
        && note.includes('USD millions')
      )).toBe(true);
      expect(workbook.review_notes.some((note) => note.includes('Bank model is equity value based; enterprise value is not applicable.'))).toBe(true);

    } finally {
      await backend.stop();
      await rm(home, {recursive: true, force: true});
    }
  }, 300_000);

  it('exports JPM and BAC bank models and blocks unsupported financial subtypes', async () => {
    assertEdgarIdentityConfigured();
    for (const ticker of ['JPM', 'BAC']) {
      const home = await mkdtemp(join(tmpdir(), `dcfbuild-live-bank-cli-${ticker.toLowerCase()}-`));
      const outputPath = join(home, `${ticker.toLowerCase()}_bank_model.xlsx`);
      try {
        const result = runLiveCli(ticker, outputPath, home);
        if (result.error) throw new Error(`Live dcfbuild failed (${result.error.name}).`);
        const output = sanitizedOutput(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
        if (result.status !== 0 && output.includes('Commercial bank model is blocked because required filed or live inputs are incomplete:')) {
          expect(output).toContain(ticker);
          expect(output).toMatch(/live_risk_free_rate|live_equity_risk_premium|dated_market_context/);
          await expect(access(outputPath)).rejects.toThrow();
          continue;
        }
        expect(result.status, output).toBe(0);
        expect(output).toContain(ticker);
        expect(output).not.toMatch(/data status is (cached|stale|default|unavailable)/i);
        const workbook = await inspectWorkbook(outputPath, {
          ticker,
          modelSheet: 'Bank Model',
          inputCell: 'B23',
          editableCells: ['B23', 'B24', 'B25', 'B26', 'B27', 'B28', 'B29', 'B30', 'B31', 'B32', 'B33', 'B34', 'B35', 'B36', 'B38'],
          formulaCells: ['B37', 'C44', 'C48', 'C50', 'C53', 'C55', 'C66', 'C71', 'C72', 'B77', 'B78', 'B80', 'B89', 'E89'],
        });
        expect(workbook.sheets).toEqual(['Bank Model', 'Data Review']);
        expect(workbook.formula_count).toBeGreaterThan(40);
        expect(workbook.formula_refs).toEqual([]);
        expect(workbook.input_font_rgb?.slice(-6)).toBe('0000FF');
        expect(Number(workbook.editable_cells.B33?.value)).toBeCloseTo(ticker === 'JPM' ? 0.115 : 0.10, 6);
        expect(workbook.formula_cells.C44).toBe('=$B$14*(1+$B$23)');
        expect(workbook.formula_cells.C50).toBe('=C48-C49');
        expect(String(workbook.formula_cells.B77)).toContain('$B$17');
        expect(workbook.review_notes.some((note) => note.includes('BankMinimumCet1Ratio'))).toBe(true);
      } finally {
        await rm(home, {recursive: true, force: true});
      }
    }

    const home = await mkdtemp(join(tmpdir(), 'dcfbuild-live-investment-bank-'));
    const outputPath = join(home, 'gs_bank_model.xlsx');
    try {
      const result = runLiveCli('GS', outputPath, home);
      if (result.error) throw new Error(`Live dcfbuild failed (${result.error.name}).`);
      const output = sanitizedOutput(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
      expect(result.status, output).not.toBe(0);
      expect(output).toContain('Bank workbook requires dedicated bank history and assumptions.');
      let outputExists = true;
      try {
        await access(outputPath);
      } catch {
        outputExists = false;
      }
      expect(outputExists).toBe(false);
    } finally {
      await rm(home, {recursive: true, force: true});
    }
  }, 600_000);

  it('matches JPM and BAC formula workbook valuations to the live engine', async () => {
    assertEdgarIdentityConfigured();
    for (const ticker of ['JPM', 'BAC']) {
      const home = await mkdtemp(join(tmpdir(), `dcfbuild-live-bank-parity-${ticker.toLowerCase()}-`));
      const backend = new LocalBackendProcess({
        backendDirectory: resolve(projectRoot, 'backend'),
        environment: {
          ...process.env,
          HOME: home,
          DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
        },
      });
      try {
        const client = new BackendApiClient(await backend.start());
        const result = await runValuationJob(ticker, client);
        expect(result.results.isValuationSupported).toBe(true);
        expect(result.results.valuationBasis).toBe('equity');
        expect(result.results.enterpriseValue).toBeNull();
        expect(result.exportPayload.bankModel?.assumptions.minimumCet1Ratio)
          .toBeCloseTo(ticker === 'JPM' ? 0.115 : 0.10, 6);
        expect(result.exportPayload.bankModel?.assumptions.assumptionSources.noninterestIncomeGrowth)
          .toContain('filed noninterest-income CAGR');
        const outputPath = join(home, `${ticker.toLowerCase()}_bank_model.xlsx`);
        await writeFile(outputPath, result.workbookBytes);
        const workbook = await inspectWorkbook(outputPath, {
          ticker,
          modelSheet: 'Bank Model',
          inputCell: 'B23',
          formulaCells: ['B37', 'C44', 'C50', 'C58', 'C66', 'C71', 'C72', 'B77', 'B78', 'B80', 'B89', 'C86', 'E89', 'H89', 'I89'],
        });
        expect(workbook.sheets).toEqual(['Bank Model', 'Data Review']);
        expect(workbook.formula_refs).toEqual([]);
        expect(workbook.formula_count).toBeGreaterThan(40);
        expect(workbook.formula_cells.B77).toBeTruthy();
        expect(workbook.formula_cells.B78).toBeTruthy();
        expect(workbook.formula_cells.B89).toBe('=$B$37');
        expect(String(workbook.formula_cells.E89)).toContain('$H89');
        expect(String(workbook.formula_cells.E89)).toContain('$I89');
      } finally {
        await backend.stop();
        await rm(home, {recursive: true, force: true});
      }
    }
  }, 600_000);

  it('names the default standalone workbook with the build date and ticker', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcf-live-dated-standalone-'));
    try {
      const result = spawnSync(process.execPath, [launcherPath, 'AAPL'], {
        cwd: projectRoot,
        env: {
          ...process.env,
          HOME: home,
          DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
        },
        encoding: 'utf8',
        maxBuffer: 3 * 1024 * 1024,
        timeout: 240_000,
      });
      if (result.error) throw result.error;
      const output = sanitizedOutput(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
      expect(result.status, output).toBe(0);
      const downloads = await readdir(join(home, 'Downloads'));
      expect(downloads).toHaveLength(1);
      expect(downloads[0]).toMatch(/^\d{4}-\d{2}-\d{2}_AAPL_DCF\.xlsx$/);
      expect(output).toContain(join(home, 'Downloads', downloads[0]!));
      expect((await stat(join(home, 'Downloads', downloads[0]!))).size).toBeGreaterThan(10_000);
    } finally {
      await rm(home, {recursive: true, force: true});
    }
  }, 600_000);

  it('rebuilds an existing library model and exports dated ticker copies', async () => {
    assertEdgarIdentityConfigured();
    const home = await mkdtemp(join(tmpdir(), 'dcf-live-dated-update-'));
    const modelsDir = join(home, 'models');
    try {
      const build = runLibraryCli(['build', 'AAPL', '--models-dir', modelsDir], home);
      if (build.error) throw build.error;
      const buildOutput = sanitizedOutput(`${build.stdout ?? ''}\n${build.stderr ?? ''}`);
      expect(build.status, buildOutput).toBe(0);
      // Build gate: the initial build stages a pending candidate and publishes
      // nothing, so the candidate must be verified and accepted first.
      const buildCandidate = /Staged build candidate (\S+) for AAPL/.exec(buildOutput)?.[1];
      expect(buildCandidate, buildOutput).toBeTruthy();
      const buildReviewText = 'Live-test review of the staged AAPL initial candidate from live SEC data. Freshness matches the staged fact source. The deterministic engine route and readiness are as reported. Staging recalculated clean with zero cached formula errors. Summary: faithful build, safe to promote.';
      const buildVerified = runLibraryCli(['model', 'candidate-verify', buildCandidate as string, '--verification', buildReviewText, '--by', 'live-suite', '--models-dir', modelsDir], home);
      if (buildVerified.error) throw buildVerified.error;
      expect(buildVerified.status, sanitizedOutput(`${buildVerified.stdout ?? ''}\n${buildVerified.stderr ?? ''}`)).toBe(0);
      const buildAccepted = runLibraryCli(['model', 'accept', buildCandidate as string, '--approve', '--by', 'live-suite', '--models-dir', modelsDir], home);
      if (buildAccepted.error) throw buildAccepted.error;
      expect(buildAccepted.status, sanitizedOutput(`${buildAccepted.stdout ?? ''}\n${buildAccepted.stderr ?? ''}`)).toBe(0);

      const update = runLibraryCli(['model', 'update', 'AAPL', '--models-dir', modelsDir], home);
      if (update.error) throw update.error;
      const updateOutput = sanitizedOutput(`${update.stdout ?? ''}\n${update.stderr ?? ''}`);
      expect(update.status, updateOutput).toBe(0);
      expect(updateOutput).toContain('route=unlevered_dcf');
      const updateCandidate = /Staged build candidate (\S+) for AAPL/.exec(updateOutput)?.[1];
      expect(updateCandidate, updateOutput).toBeTruthy();
      const updateVerified = runLibraryCli(['model', 'candidate-verify', updateCandidate as string, '--verification', buildReviewText, '--by', 'live-suite', '--models-dir', modelsDir], home);
      if (updateVerified.error) throw updateVerified.error;
      expect(updateVerified.status, sanitizedOutput(`${updateVerified.stdout ?? ''}\n${updateVerified.stderr ?? ''}`)).toBe(0);
      const updateAccepted = runLibraryCli(['model', 'accept', updateCandidate as string, '--approve', '--by', 'live-suite', '--models-dir', modelsDir], home);
      if (updateAccepted.error) throw updateAccepted.error;
      expect(updateAccepted.status, sanitizedOutput(`${updateAccepted.stdout ?? ''}\n${updateAccepted.stderr ?? ''}`)).toBe(0);

      const exported = runLibraryCli(['model', 'export', 'AAPL', '--models-dir', modelsDir], home);
      if (exported.error) throw exported.error;
      const exportOutput = sanitizedOutput(`${exported.stdout ?? ''}\n${exported.stderr ?? ''}`);
      expect(exported.status, exportOutput).toBe(0);

      const datedFiles = await readdir(join(home, 'Downloads'));
      expect(datedFiles).toHaveLength(3);
      expect(new Set(datedFiles).size).toBe(3);
      for (const name of datedFiles) expect(name).toMatch(/^\d{4}-\d{2}-\d{2}_AAPL_DCF(?:_\d{2,})?\.xlsx$/);
      await access(join(modelsDir, 'companies', 'AAPL', 'current.xlsx'));

      const reviewed = runLibraryCli(['model', 'review', 'AAPL', '--models-dir', modelsDir], home);
      if (reviewed.error) throw reviewed.error;
      const reviewOutput = sanitizedOutput(`${reviewed.stdout ?? ''}\n${reviewed.stderr ?? ''}`);
      expect(reviewed.status, reviewOutput).toBe(0);
      expect(reviewOutput).toContain('Cached formula errors: none.');
      expect(reviewOutput).toContain('Hash check: on-disk workbook matches the manifest.');

      const currentPath = join(modelsDir, 'companies', 'AAPL', 'current.xlsx');
      const overwrite = runLibraryCli([
        'model', 'update', 'AAPL', '--models-dir', modelsDir, '--output', currentPath, '--force',
      ], home);
      if (overwrite.error) throw overwrite.error;
      const overwriteOutput = sanitizedOutput(`${overwrite.stdout ?? ''}\n${overwrite.stderr ?? ''}`);
      expect(overwrite.status, overwriteOutput).not.toBe(0);
      expect(overwriteOutput).toContain('Output must not overwrite the accepted library workbook.');

      const corruptHash = spawnSync(pythonPath, ['-c',
        'import sqlite3, sys; db=sqlite3.connect(sys.argv[1]); db.execute("UPDATE companies SET workbook_hash=NULL WHERE ticker=?", (sys.argv[2],)); db.commit(); db.close()',
        join(modelsDir, 'library.db'), 'AAPL'], {encoding: 'utf8'});
      if (corruptHash.error) throw corruptHash.error;
      expect(corruptHash.status, corruptHash.stderr).toBe(0);

      const missingHashUpdate = runLibraryCli(['model', 'update', 'AAPL', '--models-dir', modelsDir], home);
      if (missingHashUpdate.error) throw missingHashUpdate.error;
      const missingHashOutput = sanitizedOutput(`${missingHashUpdate.stdout ?? ''}\n${missingHashUpdate.stderr ?? ''}`);
      expect(missingHashUpdate.status, missingHashOutput).not.toBe(0);
      expect(missingHashOutput).toContain('MANUAL_EDIT_DETECTED');
      expect(await readdir(join(home, 'Downloads'))).toHaveLength(3);
    } finally {
      await rm(home, {recursive: true, force: true});
    }
  }, 600_000);
});
