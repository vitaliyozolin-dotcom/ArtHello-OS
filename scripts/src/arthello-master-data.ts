import type { PGlite } from "@electric-sql/pglite";

const confirmationSource = "owner_message_2026-07-25";

const legalEntities = [
  {
    code: "ooo-arthello",
    displayName: "ООО АртХелло",
    legalName: "ООО АртХелло",
    entityType: "ooo",
  },
  {
    code: "ip-tyurin-pavel-olegovich",
    displayName: "ИП Тюрин Павел Олегович",
    legalName: "ИП Тюрин Павел Олегович",
    entityType: "ip",
  },
  {
    code: "ooo-uk-detskoe-obrazovanie",
    displayName: "ООО УК Детское образование",
    legalName: "ООО УК Детское образование",
    entityType: "ooo",
  },
] as const;

const operatingUnits = [
  {
    code: "atlas-kindergarten-school",
    name: "Атлас — садик и школа",
    legalEntityCode: "ooo-arthello",
  },
  {
    code: "listvennaya",
    name: "Лиственная",
    legalEntityCode: "ip-tyurin-pavel-olegovich",
  },
  {
    code: "school-1-11",
    name: "Школа 1-11",
    legalEntityCode: "ooo-uk-detskoe-obrazovanie",
  },
] as const;

export async function seedOwnerConfirmedMasterData(
  database: PGlite,
): Promise<{ legalEntities: number; operatingUnits: number }> {
  await database.exec("BEGIN");
  try {
    for (const entity of legalEntities) {
      await database.query(
        `INSERT INTO legal_entities (
           code,
           display_name,
           legal_name,
           entity_type,
           confirmation_source
         ) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (code) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           legal_name = EXCLUDED.legal_name,
           entity_type = EXCLUDED.entity_type,
           confirmation_source = EXCLUDED.confirmation_source,
           updated_at = now()`,
        [
          entity.code,
          entity.displayName,
          entity.legalName,
          entity.entityType,
          confirmationSource,
        ],
      );
    }

    for (const unit of operatingUnits) {
      await database.query(
        `INSERT INTO operating_unit_legal_entity (
           operating_unit_code,
           operating_unit_name,
           legal_entity_id,
           mapping_status,
           confirmation_source
         )
         SELECT $1, $2, id, 'owner_confirmed', $4
         FROM legal_entities
         WHERE code = $3
         ON CONFLICT (operating_unit_code) DO UPDATE SET
           operating_unit_name = EXCLUDED.operating_unit_name,
           legal_entity_id = EXCLUDED.legal_entity_id,
           mapping_status = EXCLUDED.mapping_status,
           confirmation_source = EXCLUDED.confirmation_source,
           updated_at = now()`,
        [
          unit.code,
          unit.name,
          unit.legalEntityCode,
          confirmationSource,
        ],
      );
    }
    await database.exec("COMMIT");
  } catch (error) {
    await database.exec("ROLLBACK");
    throw error;
  }

  return {
    legalEntities: legalEntities.length,
    operatingUnits: operatingUnits.length,
  };
}
