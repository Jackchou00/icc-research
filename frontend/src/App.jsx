import { useRef, useState } from "react";

function base64Json(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function editedName(name) {
  const dot = name.lastIndexOf(".");
  return `${dot > 0 ? name.slice(0, dot) : name}-edited.icc`;
}

function readDrag(event) {
  try {
    return JSON.parse(event.dataTransfer.getData("application/x-icc-tag"));
  } catch {
    return null;
  }
}

const MIN_PANEL_WIDTHS = [250, 420, 230];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export default function App() {
  const picker = useRef(null);
  const columnsRef = useRef(null);
  const resizeDrag = useRef(null);
  const [file, setFile] = useState(null);
  const [profile, setProfile] = useState(null);
  const [header, setHeader] = useState({});
  const [tags, setTags] = useState([]);
  const [staged, setStaged] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [columnWeights, setColumnWeights] = useState([0.85, 1.7, 0.8]);
  const [activeHandle, setActiveHandle] = useState(null);

  function applyResize(index, delta, widths) {
    const next = [...widths];
    if (index === 0) {
      const pairWidth = widths[0] + widths[1];
      next[0] = clamp(widths[0] + delta, MIN_PANEL_WIDTHS[0], pairWidth - MIN_PANEL_WIDTHS[1]);
      next[1] = pairWidth - next[0];
    } else {
      const pairWidth = widths[1] + widths[2];
      next[1] = clamp(widths[1] + delta, MIN_PANEL_WIDTHS[1], pairWidth - MIN_PANEL_WIDTHS[2]);
      next[2] = pairWidth - next[1];
    }
    const total = next.reduce((sum, width) => sum + width, 0);
    setColumnWeights(next.map((width) => width / total));
  }

  function beginResize(event, index) {
    event.preventDefault();
    const panels = [...columnsRef.current.querySelectorAll(":scope > .panel")];
    resizeDrag.current = {
      index,
      startX: event.clientX,
      widths: panels.map((panel) => panel.getBoundingClientRect().width),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setActiveHandle(index);
  }

  function moveResize(event) {
    const drag = resizeDrag.current;
    if (drag) applyResize(drag.index, event.clientX - drag.startX, drag.widths);
  }

  function endResize() {
    resizeDrag.current = null;
    setActiveHandle(null);
  }

  function resizeWithKeyboard(event, index) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const panels = [...columnsRef.current.querySelectorAll(":scope > .panel")];
    const widths = panels.map((panel) => panel.getBoundingClientRect().width);
    const step = event.shiftKey ? 32 : 12;
    applyResize(index, event.key === "ArrowRight" ? step : -step, widths);
  }

  async function openFile(nextFile) {
    if (!nextFile) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: nextFile,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Could not open file.");
      setFile(nextFile);
      setProfile(result);
      setHeader(result.header);
      setTags(result.tags);
      setStaged([]);
    } catch (cause) {
      setError(cause.message || "Could not open file.");
    } finally {
      setBusy(false);
    }
  }

  async function saveFile() {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Tag-Order": tags.map((tag) => tag.index).join(","),
          "X-ICC-Header": base64Json(header),
        },
        body: file,
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.detail || "Could not save file.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = editedName(file.name);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(cause.message || "Could not save file.");
    } finally {
      setBusy(false);
    }
  }

  function startDrag(event, source, id) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-icc-tag", JSON.stringify({ source, id }));
  }

  function dropOnTable(event, targetId = null) {
    event.preventDefault();
    event.stopPropagation();
    const dragged = readDrag(event);
    if (!dragged) return;
    const targetRect = event.currentTarget.getBoundingClientRect();
    const afterTarget = targetId !== null && event.clientY > targetRect.top + event.currentTarget.offsetHeight / 2;

    if (dragged.source === "table") {
      setTags((current) => {
        const from = current.findIndex((tag) => tag.index === dragged.id);
        if (from < 0) return current;
        const next = [...current];
        const [item] = next.splice(from, 1);
        let to = targetId === null ? next.length : next.findIndex((tag) => tag.index === targetId);
        if (to < 0) to = next.length;
        if (afterTarget) to += 1;
        next.splice(Math.min(to, next.length), 0, item);
        return next;
      });
      return;
    }

    if (dragged.source === "staging") {
      const item = staged.find((tag) => tag.index === dragged.id);
      if (!item) return;
      setStaged((current) => current.filter((tag) => tag.index !== dragged.id));
      setTags((current) => {
        const next = [...current];
        let to = targetId === null ? next.length : next.findIndex((tag) => tag.index === targetId);
        if (to < 0) to = next.length;
        if (afterTarget) to += 1;
        next.splice(Math.min(to, next.length), 0, item);
        return next;
      });
    }
  }

  function dropOnStaging(event, targetId = null) {
    event.preventDefault();
    event.stopPropagation();
    const dragged = readDrag(event);
    if (!dragged) return;

    if (dragged.source === "table") {
      const item = tags.find((tag) => tag.index === dragged.id);
      if (!item) return;
      setTags((current) => current.filter((tag) => tag.index !== dragged.id));
      setStaged((current) => [...current, item]);
      return;
    }

    if (dragged.source === "staging") {
      setStaged((current) => {
        const from = current.findIndex((tag) => tag.index === dragged.id);
        if (from < 0) return current;
        const next = [...current];
        const [item] = next.splice(from, 1);
        const to = targetId === null ? next.length : next.findIndex((tag) => tag.index === targetId);
        next.splice(to < 0 ? next.length : to, 0, item);
        return next;
      });
    }
  }

  function removeTag(id, source) {
    if (source === "table") setTags((current) => current.filter((tag) => tag.index !== id));
    else setStaged((current) => current.filter((tag) => tag.index !== id));
  }

  function renderTagRow(tag, position, source) {
    const inTable = source === "table";
    return (
      <tr
        key={tag.index}
        draggable
        onDragStart={(event) => startDrag(event, source, tag.index)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => inTable ? dropOnTable(event, tag.index) : dropOnStaging(event, tag.index)}
      >
        <td className="grip" aria-label="Drag">⠿</td>
        <td className="position">{inTable ? position + 1 : ""}</td>
        <td><code>{tag.signature}</code></td>
        <td className="number">{tag.offset.toLocaleString()}</td>
        <td className="number">{tag.size.toLocaleString()}</td>
        <td className="action"><button type="button" aria-label="Delete tag" onClick={() => removeTag(tag.index, source)}>×</button></td>
      </tr>
    );
  }

  return (
    <main className="app">
      <header className="toolbar">
        <button type="button" onClick={() => {
          if (picker.current) picker.current.value = "";
          picker.current?.click();
        }}>Open</button>
        <span className="filename">{file?.name || ""}</span>
        <span className="toolbar-spacer" />
        <button type="button" className="save" disabled={!file || busy} onClick={saveFile}>{busy ? "…" : "Save"}</button>
        <input
          ref={picker}
          type="file"
          accept=".icc,.icm,application/vnd.iccprofiles"
          hidden
          onChange={(event) => openFile(event.target.files?.[0])}
        />
      </header>

      {error && <div className="error" role="alert">{error}</div>}

      <section
        ref={columnsRef}
        className="columns"
        style={{
          "--header-track": `${columnWeights[0]}fr`,
          "--table-track": `${columnWeights[1]}fr`,
          "--staging-track": `${columnWeights[2]}fr`,
        }}
      >
        <section className="panel header-panel">
          <h1>Header</h1>
          <div className="field">
            <label>Profile size</label>
            <input value={profile ? `${profile.profile_size} bytes` : ""} readOnly />
          </div>
          <div className="field">
            <label>Tag table</label>
            <input value={profile ? profile.tag_table_offset : ""} readOnly />
          </div>
          {profile?.fields.map((field) => (
            <div className="field" key={field.key}>
              <label htmlFor={`header-${field.key}`}>{field.label}</label>
              <input
                id={`header-${field.key}`}
                value={header[field.key] || ""}
                maxLength={field.kind === "text" ? field.size : field.size * 2}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => setHeader((current) => ({ ...current, [field.key]: event.target.value }))}
              />
            </div>
          ))}
        </section>
        <div
          className={`resize-handle${activeHandle === 0 ? " is-active" : ""}`}
          role="separator"
          tabIndex={0}
          aria-label="Resize header and tag table"
          aria-orientation="vertical"
          onPointerDown={(event) => beginResize(event, 0)}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          onKeyDown={(event) => resizeWithKeyboard(event, 0)}
        />

        <section className="panel table-panel">
          <div className="panel-heading">
            <h1>Tag table</h1>
            <span>{tags.length}</span>
          </div>
          <div
            className="table-scroll"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => dropOnTable(event)}
          >
            <table className="tag-table">
              <colgroup>
                <col className="drag-column" />
                <col className="position-column" />
                <col />
                <col />
                <col />
                <col className="action-column" />
              </colgroup>
              <thead><tr><th></th><th>#</th><th>Tag</th><th>Offset</th><th>Size</th><th></th></tr></thead>
              <tbody>{tags.map((tag, index) => renderTagRow(tag, index, "table"))}</tbody>
            </table>
          </div>
        </section>
        <div
          className={`resize-handle${activeHandle === 1 ? " is-active" : ""}`}
          role="separator"
          tabIndex={0}
          aria-label="Resize tag table and staging"
          aria-orientation="vertical"
          onPointerDown={(event) => beginResize(event, 1)}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          onKeyDown={(event) => resizeWithKeyboard(event, 1)}
        />

        <section className="panel staging-panel">
          <div className="panel-heading">
            <h1>Staging</h1>
            <span>{staged.length}</span>
          </div>
          <div
            className="staging-drop"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => dropOnStaging(event)}
          >
            <table>
              <tbody>{staged.map((tag, index) => renderTagRow(tag, index, "staging"))}</tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}
