const leadershipRoles = new Set(["director", "deputy"]);

export function shouldShowLeadershipParentPreview({ role, view, studentCount }) {
  return leadershipRoles.has(role) && view === "people" && studentCount > 0;
}
