import type { SVGProps } from "react";

const paths: Record<string, string> = {
  home: "M3 11.5 12 4l9 7.5M5.5 10.5V20h13v-9.5M9.5 20v-6h5v6",
  tasks: "M9 5h10M9 12h10M9 19h10M4 5l1 1 2-2M4 12l1 1 2-2M4 19l1 1 2-2",
  finance: "M12 3v18M16.5 7.5c0-1.7-1.8-3-4.5-3s-4.5 1.2-4.5 3 1.7 2.8 4.5 3 4.5 1.2 4.5 3-1.8 3-4.5 3-4.5-1.3-4.5-3",
  accounting: "M4 4h16v16H4zM8 8h8M8 12h2M14 12h2M8 16h2M14 16h2",
  registry: "M4 5h16v14H4zM8 9h4M8 13h8M8 16h6",
  sales: "M4 18 10 12l4 4 6-9M15 7h5v5",
  clients: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM16 10a2.5 2.5 0 1 0 0-5M3 20c.4-4 2.2-6 5-6s4.6 2 5 6M14 14c3 0 5 2 5.5 6",
  education: "m3 9 9-5 9 5-9 5-9-5Zm4 3v5c3 2 7 2 10 0v-5",
  methods: "M5 4h10a4 4 0 0 1 4 4v12H8a3 3 0 0 1-3-3V4Zm3 13h11M9 8h6M9 11h6",
  hr: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c.5-4.5 3-7 8-7s7.5 2.5 8 7",
  legal: "M6 3h9l3 3v15H6zM14 3v4h4M9 12h6M9 16h6M9 8h2",
  procurement: "M3 6h2l2 10h10l3-7H6M9 20h.01M17 20h.01",
  food: "M7 3v7M4 3v4c0 2 1 3 3 3s3-1 3-3V3M7 10v11M16 3c-3 3-3 8 0 10h3V3M18 13v8",
  safety: "M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6l-8-3Zm-3 9 2 2 4-5",
  medical: "M9 3h6v6h6v6h-6v6H9v-6H3V9h6z",
  content: "M5 5h14v14H5zM8 9h8M8 13h5M8 16h7",
  events: "M5 4v3M19 4v3M4 8h16v12H4zM8 12h3M13 12h3M8 16h3",
  projects: "M4 18 9 13l4 3 7-9M16 7h4v4M4 5h6",
  analytics: "M4 19V9M10 19V5M16 19v-7M22 19H2",
  contractors: "M4 20v-9l8-6 8 6v9M8 20v-6h8v6M9 9h6",
  assets: "M4 8 12 4l8 4-8 4-8-4Zm0 5 8 4 8-4M4 17l8 4 8-4",
  quality: "M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6l-8-3Zm-3 9 2 2 4-4",
  access: "M8 11V8a4 4 0 0 1 8 0v3M5 11h14v10H5zM12 15v3",
  integrations: "M8 8h8v8H8zM3 12h5M16 12h5M12 3v5M12 16v5",
  acceptance: "M5 12 10 17 20 6",
  search: "M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm5-2 5 5",
  plus: "M12 5v14M5 12h14",
  bell: "M6 9a6 6 0 0 1 12 0v5l2 3H4l2-3V9M10 21h4",
  help: "M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-1.3.5-2 1.2-2 2.7M12 18h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20",
  settings: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19 12l2-1-2-4-2 .5-1.5-1.5.5-2h-4l-.5 2L7 7.5 5 7 3 11l2 1v2l-2 1 2 4 2-.5L8.5 20l.5 2h4l.5-2 1.5-1.5 2 .5 2-4-2-1v-2Z",
  back: "m15 18-6-6 6-6",
  chevron: "m9 18 6-6-6-6",
  collapse: "M15 18 9 12l6-6M4 4h16v16H4z",
  star: "m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9L6.6 20l1-6.1-4.4-4.3 6.1-.9L12 3Z",
  recent: "M4 12a8 8 0 1 0 2.3-5.7L4 8M4 4v4h4M12 8v5l3 2",
  menu: "M4 7h16M4 12h16M4 17h16",
  more: "M6 12h.01M12 12h.01M18 12h.01",
  command: "M8 8H5a3 3 0 1 1 3-3v14a3 3 0 1 1-3-3h14a3 3 0 1 1-3 3V5a3 3 0 1 1 3 3H5"
  ,logout: "M10 5H5v14h5M14 8l4 4-4 4M9 12h9"
};

export function AppIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d={paths[name] ?? paths.registry} />
    </svg>
  );
}
