import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function target(relativePath) {
  return fileURLToPath(new URL(`../${relativePath}`, import.meta.url));
}

function replaceText(source, search, replacement, label) {
  const first = source.indexOf(search);
  const second = first === -1 ? -1 : source.indexOf(search, first + search.length);
  if (first === -1 || second !== -1) {
    throw new Error(`Dialog portal patch failed at ${label}: expected exactly one text match`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + search.length)}`;
}

function patch(relativePath, transform) {
  const path = target(relativePath);
  const before = readFileSync(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`Dialog portal patch produced no changes for ${relativePath}`);
  writeFileSync(path, after, "utf8");
}

if (readFileSync(target("app/components/ContentWorkspace.tsx"), "utf8").includes('className="ahContentPage"')) {
  console.log("ContentWorkspace Design System override already owns its dialog portal");
} else patch("app/components/ContentWorkspace.tsx", (input) => {
  let source = input;
  source = replaceText(
    source,
    'import Image from "next/image";\n',
    'import Image from "next/image";\nimport { createPortal } from "react-dom";\n',
    "content portal import",
  );
  source = replaceText(
    source,
    '{createOpen ? <div className="content-modal-layer"><button className="drawer-scrim" onClick={() => setCreateOpen(false)} /><form className="content-modal" onSubmit={create}>',
    '{createOpen ? createPortal(<div className="content-modal-layer"><button className="drawer-scrim" onClick={() => setCreateOpen(false)} /><form className="content-modal" onSubmit={create}>',
    "content modal portal start",
  );
  source = replaceText(
    source,
    '</footer></form></div> : null}\n  </section>;',
    '</footer></form></div>, document.body) : null}\n  </section>;',
    "content modal portal end",
  );
  return source;
});

const integrationPath = "app/components/IntegrationWorkspace.tsx";
const integrationInput = readFileSync(target(integrationPath), "utf8");
const legacyIntegrationPortals = integrationInput.includes("{current && detailOpen ? createPortal(")
  && integrationInput.includes("return createPortal(<div className=\"integration-modal-layer\"");
const canonicalIntegrationPortalFunctions = [
  "function ConnectionDetailDialog(",
  "function ConflictResolutionDialog(",
  "function ConnectionWizard(",
];
const canonicalIntegrationPortalCount = integrationInput.match(/return createPortal\(<div className="ahIntegrationModalLayer">/g)?.length ?? 0;
const canonicalIntegrationPortals = canonicalIntegrationPortalCount === canonicalIntegrationPortalFunctions.length
  && canonicalIntegrationPortalFunctions.every((signature) => integrationInput.includes(signature));
const partialCanonicalIntegrationPortals = canonicalIntegrationPortalCount > 0
  || canonicalIntegrationPortalFunctions.slice(0, 2).some((signature) => integrationInput.includes(signature))
  || integrationInput.includes("ahIntegrationModalLayer");

if (canonicalIntegrationPortals) {
  console.log("IntegrationWorkspace canonical detail, conflict and setup portals already applied");
} else if (partialCanonicalIntegrationPortals) {
  throw new Error("Dialog portal patch found a partial canonical IntegrationWorkspace portal implementation");
} else if (legacyIntegrationPortals) {
  console.log("IntegrationWorkspace dialog portals already applied");
} else patch(integrationPath, (input) => {
  let source = input;
  source = replaceText(
    source,
    'import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";\n',
    'import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";\nimport { createPortal } from "react-dom";\n',
    "integration portal import",
  );
  source = replaceText(
    source,
    '{current && detailOpen ? <div className="integration-modal-layer">',
    '{current && detailOpen ? createPortal(<div className="integration-modal-layer">',
    "integration detail portal start",
  );
  const detailEndBefore = '      </section>\n    </div> : null}\n\n    {wizardId';
  source = replaceText(
    source,
    detailEndBefore,
    detailEndBefore.replace('</div> : null}', '</div>, document.body) : null}'),
    "integration detail portal end",
  );
  source = replaceText(
    source,
    '  return <div className="integration-modal-layer">\n    <button className="drawer-scrim" onClick={close} aria-label="Закрыть настройку" />',
    '  return createPortal(<div className="integration-modal-layer">\n    <button className="drawer-scrim" onClick={close} aria-label="Закрыть настройку" />',
    "integration wizard portal start",
  );
  const wizardEndLegacy = '    </form>\n  </div>;\n}\n\nfunction Head';
  const wizardEndWithSummary = '    </form>\n  </div>;\n}\n\nfunction savedSetupSummary';
  const wizardEndBefore = source.includes(wizardEndWithSummary) ? wizardEndWithSummary : wizardEndLegacy;
  source = replaceText(
    source,
    wizardEndBefore,
    wizardEndBefore.replace('</div>;', '</div>, document.body);'),
    "integration wizard portal end",
  );
  return source;
});

console.log("System-wide dialog portals applied");
