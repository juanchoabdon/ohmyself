"use client";

import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { useEffect, useMemo, useState } from "react";
import { omsSourceTheme } from "./sourceEditorTheme";

function readDark(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.getAttribute("data-theme") === "dark";
}

export function SourceEditor({
  value,
  onChange,
  onBlur,
}: {
  value: string;
  onChange: (markdown: string) => void;
  onBlur?: () => void;
}) {
  const [isDark, setIsDark] = useState(readDark);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setIsDark(readDark());
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  const theme = useMemo(() => omsSourceTheme(isDark), [isDark]);
  const extensions = useMemo(() => [markdown()], [isDark]);

  return (
    <CodeMirror
      key={isDark ? "dark" : "light"}
      value={value}
      height="auto"
      minHeight="8rem"
      extensions={extensions}
      theme={theme}
      onChange={onChange}
      onBlur={onBlur}
      className="oms-source-editor"
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: true,
        bracketMatching: true,
        autocompletion: false,
        history: true,
        historyKeymap: true,
      }}
    />
  );
}
