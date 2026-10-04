import { useEffect, useRef, useState } from "react";
import { MAX_PAGE_DRAWING_LENGTH } from "../noteContent";

const WIDTH = 1200;
const HEIGHT = 540;
const MAX_UNDO = 12;
const COLORS = ["#1d2723", "#d64b43", "#e88b32", "#e2c438", "#33875e", "#3f76c6", "#8658b5", "#ffffff"];

export default function PaintCanvas({ value, onChange }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const undoRef = useRef([]);
  const ownUpdateRef = useRef("");
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState("#1d2723");
  const [size, setSize] = useState(6);
  const [canUndo, setCanUndo] = useState(false);
  const [drawingError, setDrawingError] = useState("");

  function getContext() {
    return canvasRef.current?.getContext("2d", { willReadFrequently: true });
  }

  useEffect(() => {
    if (value && value === ownUpdateRef.current) {
      ownUpdateRef.current = "";
      return;
    }
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !context) return;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, WIDTH, HEIGHT);
    undoRef.current = [];
    setCanUndo(false);
    setDrawingError("");
    if (value) {
      const image = new Image();
      image.onload = () => context.drawImage(image, 0, 0, WIDTH, HEIGHT);
      image.src = value;
    }
  }, [value]);

  function rememberCanvas(context) {
    undoRef.current = [...undoRef.current.slice(-(MAX_UNDO - 1)), context.getImageData(0, 0, WIDTH, HEIGHT)];
    setCanUndo(true);
  }

  function saveCanvas() {
    const canvas = canvasRef.current;
    if (canvas) {
      const drawing = canvas.toDataURL("image/png");
      if (drawing.length > MAX_PAGE_DRAWING_LENGTH) {
        const previous = undoRef.current.pop();
        if (previous) canvas.getContext("2d")?.putImageData(previous, 0, 0);
        setCanUndo(undoRef.current.length > 0);
        setDrawingError("This drawing is larger than 2 MB. Try a simpler drawing or clear the canvas.");
        return;
      }
      setDrawingError("");
      ownUpdateRef.current = drawing;
      onChange(drawing);
    }
  }

  function pointFromEvent(event) {
    const bounds = canvasRef.current.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * (WIDTH / bounds.width),
      y: (event.clientY - bounds.top) * (HEIGHT / bounds.height),
    };
  }

  function startStroke(event) {
    const canvas = canvasRef.current;
    const context = getContext();
    if (!canvas || !context) return;
    event.preventDefault();
    rememberCanvas(context);
    drawingRef.current = true;
    canvas.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);
    context.beginPath();
    context.moveTo(point.x, point.y);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = tool === "eraser" ? "#ffffff" : color;
    context.lineWidth = tool === "eraser" ? Math.max(size * 4, 24) : size * 2;
    context.lineTo(point.x + 0.01, point.y + 0.01);
    context.stroke();
  }

  function continueStroke(event) {
    if (!drawingRef.current) return;
    const context = getContext();
    if (!context) return;
    const point = pointFromEvent(event);
    context.lineTo(point.x, point.y);
    context.stroke();
  }

  function finishStroke() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    getContext()?.closePath();
    saveCanvas();
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    const context = getContext();
    if (!canvas || !context) return;
    rememberCanvas(context);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, WIDTH, HEIGHT);
    saveCanvas();
  }

  function undo() {
    const context = getContext();
    const previous = undoRef.current.pop();
    if (!context || !previous) return;
    context.putImageData(previous, 0, 0);
    setCanUndo(undoRef.current.length > 0);
    saveCanvas();
  }

  return <section className="paint-panel" aria-label="Drawing canvas">
    <div className="paint-toolbar" role="toolbar" aria-label="Drawing tools">
      <div className="paint-tool-group">
        <button type="button" className={tool === "pen" ? "active" : ""} aria-pressed={tool === "pen"} onClick={() => setTool("pen")}>✎ Pen</button>
        <button type="button" className={tool === "eraser" ? "active" : ""} aria-pressed={tool === "eraser"} onClick={() => setTool("eraser")}>⌫ Eraser</button>
      </div>
      <div className="paint-colors" role="group" aria-label="Pen color">
        {COLORS.map((paintColor) => <button
          className={`paint-color${color === paintColor ? " selected" : ""}`}
          key={paintColor}
          type="button"
          aria-label={`Color ${paintColor}`}
          aria-pressed={color === paintColor}
          style={{ "--paint-color": paintColor }}
          onClick={() => { setColor(paintColor); setTool("pen"); }}
        />)}
        <label className="paint-custom-color" title="Custom color">
          <span>＋</span>
          <input aria-label="Custom color" type="color" value={color} onChange={(event) => { setColor(event.target.value); setTool("pen"); }} />
        </label>
      </div>
      <label className="paint-size">Brush
        <select aria-label="Brush size" value={size} onChange={(event) => setSize(Number(event.target.value))}>
          <option value="2">Small</option>
          <option value="4">Medium</option>
          <option value="7">Large</option>
          <option value="12">Extra large</option>
        </select>
      </label>
      <div className="paint-actions">
        <button type="button" onClick={undo} disabled={!canUndo}>Undo</button>
        <button type="button" onClick={clearCanvas}>Clear</button>
      </div>
    </div>
    {drawingError && <p className="paint-error" role="alert">{drawingError}</p>}
    <canvas
      ref={canvasRef}
      className="paint-surface"
      width={WIDTH}
      height={HEIGHT}
      aria-label="Draw here"
      onPointerDown={startStroke}
      onPointerMove={continueStroke}
      onPointerUp={finishStroke}
      onPointerCancel={finishStroke}
    />
  </section>;
}
