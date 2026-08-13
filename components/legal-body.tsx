// The blocks from `lib/legal/markdown.ts` as React elements.
//
// A server component, because there is nothing interactive here — and no
// `dangerouslySetInnerHTML`, which is the whole security story: the parser
// hands back data, and text can only ever become a string inside an element.
// There is no sanitiser here to keep current, because there is no HTML.
import type { Block, Inline } from "@/lib/legal/markdown";

function runs(parts: Inline[]) {
  return parts.map((part, index) => {
    switch (part.kind) {
      case "strong":
        return (
          <strong key={index} className="font-semibold">
            {part.text}
          </strong>
        );
      case "em":
        return <em key={index}>{part.text}</em>;
      case "link":
        return (
          <a
            key={index}
            href={part.href}
            className="text-primary underline underline-offset-4"
            // Only for links that leave the app in a BROWSER. `rel` matters on
            // those and is noise on an internal one, and `/impressum` linking to
            // `/datenschutz` should stay in the tab the reader is in.
            //
            // ⚠️ It used to ask "does it start with `/`", which made every
            // `mailto:` and `tel:` external — and those open a mail client or a
            // dialler and leave an empty browser tab standing. `SAFE_HREF` in
            // `lib/legal/markdown.ts` admits four schemes, so the question is
            // which of them a NEW TAB is right for, and that is http(s) alone.
            {...(/^https?:\/\//i.test(part.href)
              ? { target: "_blank", rel: "noopener noreferrer" }
              : {})}
          >
            {part.text}
          </a>
        );
      default:
        return <span key={index}>{part.text}</span>;
    }
  });
}

export function LegalBody({ blocks }: { blocks: Block[] }) {
  // The shallowest heading this text has — 1 when it has none, so the arithmetic
  // below is the identity and a text without headings is untouched.
  const top = blocks.reduce(
    (shallowest, block) =>
      block.kind === "heading" ? Math.min(shallowest, block.level) : shallowest,
    3,
  );

  return (
    <div className="flex flex-col gap-4">
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          // h1 is the page title, rendered by PageHeader — so the text's own top
          // level becomes an h2 and the outline stays legal rather than doubling
          // the top level. h3/h4 follow from there.
          //
          // 🚨 **Relative to the SHALLOWEST heading the text actually has, not
          // to `#`.** A body that opens with `## Überblick` — an ordinary way to
          // write, and the operator has no way to know this file starts counting
          // at `#` — produced h1 followed by h3, a heading-order failure
          // (WCAG 1.3.1) on a page every paying member reads. `ux-check` has no
          // rule about document outline, so nothing said so.
          const Tag = (["h2", "h3", "h4"] as const)[block.level - top];
          const size = ["text-xl", "text-lg", "text-base"][block.level - top];
          return (
            <Tag key={index} className={`${size} mt-4 font-semibold first:mt-0`}>
              {block.text}
            </Tag>
          );
        }

        if (block.kind === "list") {
          return (
            <ul key={index} className="ml-5 list-disc space-y-1 text-sm">
              {block.items.map((item, i) => (
                <li key={i}>{runs(item)}</li>
              ))}
            </ul>
          );
        }

        return (
          <p key={index} className="text-sm leading-relaxed">
            {block.lines.map((line, i) => (
              <span key={i}>
                {runs(line)}
                {i < block.lines.length - 1 ? " " : null}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
