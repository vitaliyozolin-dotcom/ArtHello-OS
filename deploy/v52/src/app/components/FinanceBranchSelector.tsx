"use client";

export type FinanceBranchOption = {
  id: string;
  name: string;
};

export function FinanceBranchSelector({
  selectedBranch,
  branches,
  onChange,
}: {
  selectedBranch: string;
  branches: FinanceBranchOption[];
  onChange: (branchId: string) => void;
}) {
  const selectedValue = branches.some((branch) => branch.id === selectedBranch) ? selectedBranch : "";
  const available = branches.length > 0;

  return (
    <label className="ahFinanceBranchSelector">
      <span>Филиал</span>
      <select
        aria-label="Выбрать филиал для финансового отчёта"
        value={selectedValue}
        disabled={!available}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="" disabled>{available ? "Выберите филиал" : "Филиалы недоступны"}</option>
        {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select>
    </label>
  );
}
