import { pool } from "@workspace/db";

interface ExpectedMigration {
  sha256: string;
  timestamp: number;
}

interface MigrationStateQueryable {
  query<Row extends Record<string, unknown>>(
    text: string,
  ): Promise<{ rows: Row[] }>;
}

export const REQUIRED_MIGRATION_STATE: readonly ExpectedMigration[] = [
  {
    timestamp: 1779533561810,
    sha256: "2ae4cbc4bf7921d6d85949d03ae5fb03485ea07f8f154c53279c160b04a17cad",
  },
  {
    timestamp: 1779537865333,
    sha256: "f1fd90196fbad083212be7734c9b23ed51e03323c789626304072a64e1c3acc1",
  },
  {
    timestamp: 1779641757810,
    sha256: "11cb684cdef16cf4835149d7dcd6c75afeb12f13a007f2b33794aa178d5d8a73",
  },
  {
    timestamp: 1748102400000,
    sha256: "d7dd1f3ad162e75285a01804f1e1bb16a146755fbe193480df8fec32e22c9572",
  },
  {
    timestamp: 1780048515644,
    sha256: "987047aa3029f13f39d87157c0dec50569be4d1d42c57fb0c1ccf9474f8f5161",
  },
  {
    timestamp: 1780052614426,
    sha256: "28cb10d6d6edf32aad44894df4ab22957535390a2b0352e522f975cdcbabc0a7",
  },
  {
    timestamp: 1780085083708,
    sha256: "67839f32b1b8911110624bb3902370ec51339a39d38e9d816d199b8a264978ea",
  },
  {
    timestamp: 1780086047304,
    sha256: "2d67b7ec65705ebf7989ed519f85aeec8745fb4c6ca3aa98b208c23b0af60330",
  },
  {
    timestamp: 1780134308738,
    sha256: "d13815000e97b9aa7a0101c9b530cdcb2b91621268400bfc9e3813c7854bb9a7",
  },
  {
    timestamp: 1784855800331,
    sha256: "b6249690fc7e5827aa543a2bfcfbfc1170a0183278492da161907c16c786efab",
  },
  {
    timestamp: 1784858251868,
    sha256: "2394a6f7fa2f17c10d8b92560219a05fc1f054a327c133b278a17662087f1843",
  },
  {
    timestamp: 1785000755923,
    sha256: "649defb2e313dd59f6e8c1ed75ab6f4d2e51d44a3c4186a1f915bbfe237d5c57",
  },
  {
    timestamp: 1785004733052,
    sha256: "14ff7365a17183f86f7c23cc789956d7b1631b92b012368b23edf5f7eb49bbec",
  },
  {
    timestamp: 1785006559523,
    sha256: "73d5c3edaf7dee44a71907aef61339096c47cee978424157537dbe8ae5699139",
  },
  {
    timestamp: 1785008758984,
    sha256: "906a0ebb5b8b2a5f396550418585c69d624dffe052fc8ff9e478f3fc2e13b0d8",
  },
  {
    timestamp: 1785092263278,
    sha256: "f06f8d5af39b2b6d690c7af64c8bf6606b0593758ef8d6e2ffca6bf9b70842f4",
  },
  {
    timestamp: 1787184000000,
    sha256: "8a471a91e18919c1a9408394d1b26c551721fd66ca806f85faadd796403a3ca4",
  },
  {
    timestamp: 1787788800000,
    sha256: "707a77fa43c5b6d30dd95f98f1db4cfba401995c77c80100093a8b755f056c5d",
  },
  {
    timestamp: 1788901853908,
    sha256: "63e7578ca6715678a98895b3ffa8b5c394f244fe2a905b75ecb87e6a2e6c0fbd",
  },
  {
    timestamp: 1789130135005,
    sha256: "1f7db04cba6dbb4edf7963773f3fd70db1c4c6f52bae487d647261725d1e72a6",
  },
];

export async function assertMigrationStateReady(
  queryable: MigrationStateQueryable = pool,
  expected: readonly ExpectedMigration[] = REQUIRED_MIGRATION_STATE,
): Promise<void> {
  const result = await queryable.query<{ hash: string; created_at: string }>(
    `SELECT hash, created_at::text AS created_at
     FROM drizzle.__drizzle_migrations
     ORDER BY id`,
  );
  if (result.rows.length !== expected.length) {
    throw new Error(
      "Required migration state is incomplete or contains unknown entries",
    );
  }
  for (let index = 0; index < expected.length; index += 1) {
    const actual = result.rows[index];
    const required = expected[index];
    if (
      actual.hash !== required.sha256 ||
      actual.created_at !== String(required.timestamp)
    ) {
      throw new Error(`Required migration state differs at position ${index}`);
    }
  }
}
