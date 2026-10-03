/** Test probe: exercise toCellEdit with an =-prefixed proposedValue. */
import { toCellEdit } from '@/review/apply-service';

try {
  toCellEdit({ sheet: 'Model', cell: 'A1', proposedValue: '=SUM(A2:A3)', rationale: 'r', source: 's', accession: 'a' });
  process.stdout.write(JSON.stringify({ rejected: false }));
} catch {
  process.stdout.write(JSON.stringify({ rejected: true }));
}
