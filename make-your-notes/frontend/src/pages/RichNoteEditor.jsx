import { useEffect, useRef } from "react";

const tools = [
  { label: "Paragraph", title: "Paragraph", command: "formatBlock", value: "p" },
  { label: "Heading", title: "Heading", command: "formatBlock", value: "h2" },
  { label: "Subheading", title: "Subheading", command: "formatBlock", value: "h3" },
  { label: "B", title: "Bold", command: "bold", style: "bold" },
  { label: "I", title: "Italic", command: "italic", style: "italic" },
  { label: "U", title: "Underline", command: "underline", style: "underline" },
  { label: "• List", title: "Bulleted list", command: "insertUnorderedList" },
  { label: "1. List", title: "Numbered list", command: "insertOrderedList" },
  { label: "Quote", title: "Quote", command: "formatBlock", value: "blockquote" },
  { label: "Highlight", title: "Highlight", command: "hiliteColor", value: "#fff2a8" },
];

export default function RichNoteEditor({ value, onChange }) {
  const editorRef = useRef(null);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
  }, [value]);

  function applyTool(tool) {
    editorRef.current?.focus();
    document.execCommand(tool.command, false, tool.value);
    onChange(editorRef.current?.innerHTML || "");
  }

  return <div className="rich-note-editor">
    <div className="rich-note-toolbar" role="toolbar" aria-label="Note formatting">
      {tools.map((tool) => <button
        className={tool.style ? `format-${tool.style}` : ""}
        key={tool.title}
        type="button"
        title={tool.title}
        aria-label={tool.title}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => applyTool(tool)}
      >{tool.label}</button>)}
    </div>
    <div
      ref={editorRef}
      className="rich-note-canvas"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label="Note content"
      aria-multiline="true"
      data-placeholder="Start writing your notes here..."
      onInput={(event) => onChange(event.currentTarget.innerHTML)}
    />
  </div>;
}
