import CodeBlock from "@tiptap/extension-code-block";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { CodeBlockView } from "./CodeBlockView";

export const OmsCodeBlock = CodeBlock.extend({
  selectable: true,
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
});
