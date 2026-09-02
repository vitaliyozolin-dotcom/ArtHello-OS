type MedicalGrant = {
  principalRef: string;
  scope: string;
  status: string;
  validUntil: string;
};

export function medicalAccess(role: string, grant: MedicalGrant | undefined, asOf: string) {
  return Boolean(
    grant
    && role === "MEDICAL"
    && grant.principalRef === "ROLE:MEDICAL"
    && grant.scope === "MEDICAL_FULL_SYNTHETIC"
    && grant.status === "Активен"
    && grant.validUntil >= asOf,
  );
}

export function medicalExpiry(validUntil: string, asOf: string) {
  const days = Math.ceil((new Date(`${validUntil}T00:00:00Z`).getTime() - new Date(`${asOf}T00:00:00Z`).getTime()) / 864e5);
  return days < 0 ? "Истёк" : days <= 30 ? "Истекает" : "Действует";
}
export function canCloseMedicalCase(input:{pendingActions:number;confirmationRef:string;result:string}){return input.pendingActions===0&&input.confirmationRef.trim().length>=5&&input.result.trim().length>=8}
export function minimalMedicalDisclosure(restriction:{limitation:string;actionScope:string}){return{limitation:restriction.limitation,actionScope:restriction.actionScope}}
