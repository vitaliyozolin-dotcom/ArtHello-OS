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

patch("app/components/ContentWorkspace.tsx", (input) => {
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

patch("app/components/IntegrationWorkspace.tsx", (input) => {
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
  source = replaceText(
    source,
    '      </section>\n    </div> : null}\n\n    {wizardId ?',
    '      </section>\n    </div>, document.body) : null}\n\n    {wizardId ?',
    "integration detail portal end",
  );
  source = replaceText(
    source,
    '  return <div className="integration-modal-layer">\n    <button className="drawer-scrim" onClick={close} aria-label="Закрыть настройку" />',
    '  return createPortal(<div className="integration-modal-layer">\n    <button className="drawer-scrim" onClick={close} aria-label="Закрыть настройку" />',
    "integration wizard portal start",
  );
  source = replaceText(
    source,
    '    </form>\n  </div>;\n}\n\nfunction Head',
    '    </form>\n  </div>, document.body);\n}\n\nfunction Head',
    "integration wizard portal end",
  );
  return source;
});

console.log("System-wide dialog portals applied");

