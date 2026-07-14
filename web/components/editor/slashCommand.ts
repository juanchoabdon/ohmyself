import { Extension } from "@tiptap/core";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import { SlashCommandList, type SlashCommandItem } from "./SlashCommandList";

const HTML_STARTER = `<div style="padding:1rem;border:1px solid var(--border);border-radius:8px;">
  <h3 style="margin:0 0 0.5rem">Preview</h3>
  <p style="margin:0;color:var(--muted)">Edit this block to embed HTML.</p>
</div>`;

export const slashCommandItems: SlashCommandItem[] = [
  {
    title: "Heading 1",
    hint: "#",
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run(),
  },
  {
    title: "Heading 2",
    hint: "##",
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run(),
  },
  {
    title: "Heading 3",
    hint: "###",
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run(),
  },
  {
    title: "Bullet list",
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: "Task list",
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    title: "Quote",
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    title: "Divider",
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    title: "Table",
    hint: "3×3",
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
  {
    title: "HTML preview",
    hint: "embed",
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "codeBlock",
          attrs: { language: "html preview" },
          content: [{ type: "text", text: HTML_STARTER }],
        })
        .run(),
  },
  {
    title: "Callout",
    hint: "info",
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "callout",
          attrs: { type: "info", title: "Title" },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Body text here." }],
            },
          ],
        })
        .run(),
  },
  {
    title: "Mermaid",
    hint: "diagram",
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "codeBlock",
          attrs: { language: "mermaid" },
          content: [{ type: "text", text: "flowchart LR\n  A[Start] --> B[End]" }],
        })
        .run(),
  },
  {
    title: "Wiki link",
    hint: "[[path]]",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).insertContent("[[notes/example]]").run(),
  },
];

function filterItems(query: string): SlashCommandItem[] {
  const q = query.toLowerCase().trim();
  if (!q) return slashCommandItems;
  return slashCommandItems.filter(
    (item) => item.title.toLowerCase().includes(q) || item.hint?.toLowerCase().includes(q),
  );
}

export const SlashCommand = Extension.create({
  name: "slashCommand",

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: "/",
        allowSpaces: true,
        command: ({ editor, range, props }) => {
          (props as SlashCommandItem).command({ editor, range });
        },
        items: ({ query }) => filterItems(query),
        render: () => {
          let component: ReactRenderer | null = null;
          let popup: TippyInstance[] | null = null;

          return {
            onStart: (props: SuggestionProps<SlashCommandItem>) => {
              component = new ReactRenderer(SlashCommandList, {
                props: {
                  items: props.items,
                  command: (item: SlashCommandItem) => props.command(item),
                },
                editor: props.editor,
              });

              if (!props.clientRect) return;

              popup = tippy("body", {
                getReferenceClientRect: props.clientRect as () => DOMRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: "manual",
                placement: "bottom-start",
              });
            },
            onUpdate(props: SuggestionProps<SlashCommandItem>) {
              component?.updateProps({
                items: props.items,
                command: (item: SlashCommandItem) => props.command(item),
              });
              if (popup?.[0] && props.clientRect) {
                popup[0].setProps({ getReferenceClientRect: props.clientRect as () => DOMRect });
              }
            },
            onKeyDown(props: { event: KeyboardEvent }) {
              if (props.event.key === "Escape") {
                popup?.[0]?.hide();
                return true;
              }
              return (component?.ref as { onKeyDown?: (p: { event: KeyboardEvent }) => boolean } | null)?.onKeyDown?.(
                props,
              ) ?? false;
            },
            onExit() {
              popup?.[0]?.destroy();
              component?.destroy();
            },
          };
        },
      }),
    ];
  },
});
