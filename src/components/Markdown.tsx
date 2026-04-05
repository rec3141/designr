"use client";
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Split a string on #RRGGBB hex codes and render tiny color chips inline.
// Extracted here so the markdown renderer can reuse it for text nodes.
function stringWithHexChips(text: string): React.ReactNode {
  const parts = text.split(/(#[0-9a-fA-F]{6}\b)/g);
  return parts.map((p, i) =>
    /^#[0-9a-fA-F]{6}$/.test(p) ? (
      <span key={i} className="hex-inline">
        <span className="hex-chip" style={{ background: p }} />
        <code>{p}</code>
      </span>
    ) : (
      <React.Fragment key={i}>{p}</React.Fragment>
    )
  );
}

// Walk a React children tree and replace any string leaves with hex-chip
// markup. This lets hex codes inside **bold** / *italic* / list items render
// as chips without needing a dedicated rehype plugin.
function withHexChips(node: React.ReactNode): React.ReactNode {
  if (typeof node === "string") return stringWithHexChips(node);
  if (typeof node === "number" || node === null || node === undefined) return node;
  if (Array.isArray(node)) {
    return node.map((n, i) => (
      <React.Fragment key={i}>{withHexChips(n)}</React.Fragment>
    ));
  }
  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode };
    if (props.children === undefined) return node;
    return React.cloneElement(
      node as React.ReactElement<{ children?: React.ReactNode }>,
      {},
      withHexChips(props.children)
    );
  }
  return node;
}

// Helper factory — returns a component that renders its tag with hex-chip
// post-processing applied to its children.
function taggedWithChips<Tag extends keyof JSX.IntrinsicElements>(
  Tag: Tag
): React.FC<{ children?: React.ReactNode }> {
  const Comp: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const element = React.createElement(Tag, null, withHexChips(children));
    return element;
  };
  Comp.displayName = `MarkdownWithChips(${String(Tag)})`;
  return Comp;
}

export default function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: taggedWithChips("p"),
        li: taggedWithChips("li"),
        h1: taggedWithChips("h1"),
        h2: taggedWithChips("h2"),
        h3: taggedWithChips("h3"),
        h4: taggedWithChips("h4"),
        h5: taggedWithChips("h5"),
        h6: taggedWithChips("h6"),
        td: taggedWithChips("td"),
        th: taggedWithChips("th"),
        blockquote: taggedWithChips("blockquote"),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
