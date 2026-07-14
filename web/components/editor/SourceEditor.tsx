"use client";

import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";

export function SourceEditor({
  value,
  onChange,
  onBlur,
}: {
  value: string;
  onChange: (markdown: string) => void;
  onBlur?: () => void;
}) {
  return (
    <CodeMirror
      value={value}
      height="auto"
      minHeight="8rem"
      extensions={[markdown()]}
      onChange={onChange}
      onBlur={onBlur}
      className="oms-source-editor"
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: true,
        bracketMatching: true,
        autocompletion: false,
      }}
    />
  );
}
