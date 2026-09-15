import { directoryRequest } from '../../../../server/directory-transport.mjs';
import { ensureDatabaseReady, getDatabase } from '../../../../server/database';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  return directoryRequest(request, {
    systemId: 'SYS-SCHOOL-1-11',
    branchId: 'BR-SCHOOL',
    secret: process.env.CENTRAL_ACCESS_SECRET,
    openDatabase: async () => { await ensureDatabaseReady(); return getDatabase(); },
  });
}
