import { institution } from '../../../../lib/institution.mjs';
import { directoryRequest } from '../../../../server/directory-transport.mjs';
import { ensureDatabaseReady, getDatabase } from '../../../../server/database';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  return directoryRequest(request, {
    systemId: institution.systemId,
    branchId: institution.branchId,
    secret: process.env.CENTRAL_ACCESS_SECRET,
    openDatabase: async () => { await ensureDatabaseReady(); return getDatabase(); },
  });
}
