"use client";

import { useRouter } from "next/navigation";
import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getJob, getOutput, getVideo, renderVideo } from "../lib/api";
import { Cue, StyleConfig, TextAlignMode, VideoInfo } from "../lib/types";
import { parseVtt } from "../lib/vtt";

const MIN_WIDTH_RATIO = 0.25;
const MAX_WIDTH_RATIO = 1;
const MIN_HEIGHT_RATIO = 0.08;
const MAX_HEIGHT_RATIO = 0.5;

type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const defaultStyle: StyleConfig = {
  fontSize: 35,
  position: { x: 0.5, y: 0.85 },
  maxWidthRatio: 0.9,
  stroke: { enabled: true, width: 2 },
  shadow: { enabled: true, opacity: 0.3 },
  fontFamily: "Noto Sans SC",
  fontColor: "#ffffff",
  textAlign: "center",
};

const clamp = (value: number, min = 0, max = 1): number => Math.min(max, Math.max(min, value));
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const formatInputValue = (num: number, precision: number): string => {
  if (!Number.isFinite(num)) {
    return "";
  }
  if (precision <= 0) {
    return String(Math.round(num));
  }
  return num.toFixed(precision);
};
const normalizeByDecimals = (num: number, precision: number): number => {
  if (precision <= 0) {
    return Math.round(num);
  }
  return Number(num.toFixed(precision));
};

const isCjkChar = (char: string): boolean => /[㐀-鿿豈-﫿]/.test(char);

const wrapLineWithLimit = (line: string, maxCharsPerLine: number): string[] => {
  if (maxCharsPerLine <= 1) {
    return line ? line.split("") : [""];
  }

  const hasWhitespace = /\s/.test(line);
  if (!hasWhitespace) {
    const chunks: string[] = [];
    let current = "";
    for (const ch of line) {
      if ((current + ch).length > maxCharsPerLine) {
        chunks.push(current);
        current = ch;
      } else {
        current += ch;
      }
    }
    if (current) {
      chunks.push(current);
    }
    return chunks.length > 0 ? chunks : [""];
  }

  const tokens = line.split(/(\s+)/).filter((token) => token.length > 0);
  const lines: string[] = [];
  let current = "";

  for (const token of tokens) {
    if (current.length + token.length <= maxCharsPerLine) {
      current += token;
      continue;
    }

    if (current.trim().length > 0) {
      lines.push(current.trimEnd());
      current = "";
    }

    if (token.length <= maxCharsPerLine) {
      current = token.trimStart();
      continue;
    }

    for (const ch of token) {
      if ((current + ch).length > maxCharsPerLine) {
        lines.push(current.trimEnd());
        current = ch;
      } else {
        current += ch;
      }
    }
  }

  if (current.trim().length > 0) {
    lines.push(current.trimEnd());
  }

  return lines.length > 0 ? lines : [""];
};

const wrapTextToLines = (text: string, maxCharsPerLine: number): string[] => {
  const normalized = text.replace(/\r/g, "");
  const sourceLines = normalized.split("\n");
  const result: string[] = [];

  for (const sourceLine of sourceLines) {
    if (!sourceLine) {
      result.push("");
      continue;
    }
    result.push(...wrapLineWithLimit(sourceLine, maxCharsPerLine));
  }

  return result.length > 0 ? result : [""];
};

const fitSubtitleTextToBox = (params: {
  text: string;
  boxWidthPx: number;
  boxHeightPx: number;
  fontSize: number;
}): { text: string; truncated: boolean } => {
  const safeWidth = Math.max(1, params.boxWidthPx);
  const safeHeight = Math.max(1, params.boxHeightPx);
  const safeFont = Math.max(10, params.fontSize);

  // Heuristic for mixed CJK/latin text to keep wrapping consistent in preview.
  const approxCharWidth = safeFont * 0.62;
  const maxCharsPerLine = Math.max(1, Math.floor(safeWidth / approxCharWidth));
  const lineHeight = safeFont * 1.25;
  const maxLines = Math.max(1, Math.floor(safeHeight / lineHeight));

  const wrappedLines = wrapTextToLines(params.text, maxCharsPerLine);
  if (wrappedLines.length <= maxLines) {
    return {
      text: wrappedLines.join("\n"),
      truncated: false,
    };
  }

  const visibleLines = wrappedLines.slice(0, maxLines);
  const lastIndex = visibleLines.length - 1;
  const trimmedLast = (visibleLines[lastIndex] ?? "").trimEnd();
  const ellipsis = isCjkChar(params.text.charAt(0)) ? "…" : "...";

  const maxLastLineLength = Math.max(0, maxCharsPerLine - 1);
  const baseLine = trimmedLast.slice(0, maxLastLineLength);
  visibleLines[lastIndex] = baseLine ? baseLine + "…" : ellipsis;

  return {
    text: visibleLines.join("\n"),
    truncated: true,
  };
};

interface SliderNumberControlProps {
  fieldKey: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onValueChange: (value: number) => void;
  onErrorChange: (field: string, message?: string) => void;
  errorMessage?: string;
  decimals?: number;
}

function SliderNumberControl({
  fieldKey,
  label,
  value,
  min,
  max,
  step,
  onValueChange,
  onErrorChange,
  errorMessage,
  decimals = 2,
}: SliderNumberControlProps) {
  const [inputValue, setInputValue] = useState(formatInputValue(value, decimals));

  useEffect(() => {
    setInputValue(formatInputValue(value, decimals));
  }, [value, decimals]);

  const applyParsedValue = (rawValue: string, finalCommit: boolean): void => {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      if (finalCommit) {
        onErrorChange(fieldKey, `请输入数字，范围 ${min} ~ ${max}`);
        setInputValue(formatInputValue(value, decimals));
      }
      return;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      if (finalCommit) {
        onErrorChange(fieldKey, `请输入数字，范围 ${min} ~ ${max}`);
        setInputValue(formatInputValue(value, decimals));
      }
      return;
    }

    const normalized = normalizeByDecimals(parsed, decimals);
    if (normalized < min || normalized > max) {
      onErrorChange(fieldKey, `可输入范围：${min} ~ ${max}`);
      if (finalCommit) {
        setInputValue(formatInputValue(value, decimals));
      }
      return;
    }

    onErrorChange(fieldKey);
    onValueChange(normalized);
    setInputValue(formatInputValue(normalized, decimals));
  };

  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span>
        {label}：{value.toFixed(decimals)}
      </span>
      <div className="row" style={{ alignItems: "stretch" }}>
        <input
          style={{ flex: 1 }}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => {
            onErrorChange(fieldKey);
            const normalized = normalizeByDecimals(Number(event.target.value), decimals);
            onValueChange(normalized);
            setInputValue(formatInputValue(normalized, decimals));
          }}
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={inputValue}
          onChange={(event) => {
            const raw = event.target.value;
            setInputValue(raw);
            applyParsedValue(raw, false);
          }}
          onBlur={() => applyParsedValue(inputValue, true)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              applyParsedValue(inputValue, true);
            }
          }}
          style={{ width: 96 }}
        />
      </div>
      {errorMessage ? <span style={{ color: "var(--danger)", fontSize: 13 }}>{errorMessage}</span> : null}
    </label>
  );
}

export function VideoEditor({ videoId }: { videoId: string }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const dragDeltaRef = useRef({ x: 0, y: 0 });

  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [styleConfig, setStyleConfig] = useState<StyleConfig>(defaultStyle);
  const [boxHeightRatio, setBoxHeightRatio] = useState(0.14);
  const [cues, setCues] = useState<Cue[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [loading, setLoading] = useState(true);
  const [renderStatus, setRenderStatus] = useState("");
  const [rendering, setRendering] = useState(false);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [previewSize, setPreviewSize] = useState({ width: 1280, height: 720 });
  const [resizeState, setResizeState] = useState<
    | {
        handle: ResizeHandle;
        startX: number;
        startY: number;
        startWidth: number;
        startHeight: number;
        startPosX: number;
        startPosY: number;
      }
    | null
  >(null);

  const activeCue = useMemo(() => {
    return cues.find((cue) => currentTime >= cue.startSec && currentTime <= cue.endSec) ?? null;
  }, [currentTime, cues]);

  const loadVideo = useCallback(async () => {
    const info = await getVideo(videoId);
    setVideo(info);
    if (info.outputUrl) {
      setOutputUrl(info.outputUrl);
    }

    if (info.subtitleZhUrl) {
      const response = await fetch(info.subtitleZhUrl);
      const text = await response.text();
      setCues(parseVtt(text));
    }
  }, [videoId]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        await loadVideo();
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [loadVideo]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }

    const updateSize = () => {
      const rect = wrapper.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setPreviewSize({
          width: rect.width,
          height: rect.height,
        });
      }
    };

    updateSize();

    const observer = new ResizeObserver(() => {
      updateSize();
    });

    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isDragging || resizeState) {
      return;
    }

    const handleMove = (event: PointerEvent) => {
      const wrapper = wrapperRef.current;
      if (!wrapper) {
        return;
      }

      const rect = wrapper.getBoundingClientRect();
      const x = (event.clientX - rect.left - dragDeltaRef.current.x) / rect.width;
      const y = (event.clientY - rect.top - dragDeltaRef.current.y) / rect.height;

      setStyleConfig((prev) => ({
        ...prev,
        position: {
          x: clamp(x, prev.maxWidthRatio / 2, 1 - prev.maxWidthRatio / 2),
          y: clamp(y, boxHeightRatio / 2, 1 - boxHeightRatio / 2),
        },
      }));
    };

    const handleUp = () => setIsDragging(false);

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);

    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [isDragging, boxHeightRatio, resizeState]);

  useEffect(() => {
    if (!resizeState) {
      return;
    }

    const handleMove = (event: PointerEvent) => {
      const wrapper = wrapperRef.current;
      if (!wrapper) {
        return;
      }

      const rect = wrapper.getBoundingClientRect();
      const dx = (event.clientX - resizeState.startX) / rect.width;
      const dy = (event.clientY - resizeState.startY) / rect.height;

      let nextWidth = resizeState.startWidth;
      let nextHeight = resizeState.startHeight;
      let nextPosX = resizeState.startPosX;
      let nextPosY = resizeState.startPosY;

      if (resizeState.handle.includes("e")) {
        nextWidth = resizeState.startWidth + dx;
        nextPosX = resizeState.startPosX + dx / 2;
      }
      if (resizeState.handle.includes("w")) {
        nextWidth = resizeState.startWidth - dx;
        nextPosX = resizeState.startPosX + dx / 2;
      }
      if (resizeState.handle.includes("s")) {
        nextHeight = resizeState.startHeight + dy;
        nextPosY = resizeState.startPosY + dy / 2;
      }
      if (resizeState.handle.includes("n")) {
        nextHeight = resizeState.startHeight - dy;
        nextPosY = resizeState.startPosY + dy / 2;
      }

      nextWidth = clamp(nextWidth, MIN_WIDTH_RATIO, MAX_WIDTH_RATIO);
      nextHeight = clamp(nextHeight, MIN_HEIGHT_RATIO, MAX_HEIGHT_RATIO);
      nextPosX = clamp(nextPosX, nextWidth / 2, 1 - nextWidth / 2);
      nextPosY = clamp(nextPosY, nextHeight / 2, 1 - nextHeight / 2);

      setStyleConfig((prev) => ({
        ...prev,
        maxWidthRatio: nextWidth,
        position: {
          x: nextPosX,
          y: nextPosY,
        },
      }));
      setBoxHeightRatio(nextHeight);
    };

    const handleUp = () => setResizeState(null);

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);

    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [resizeState]);

  const setError = (field: string, message?: string) => {
    setErrors((prev) => {
      if (!message) {
        const { [field]: _ignore, ...rest } = prev;
        return rest;
      }
      return {
        ...prev,
        [field]: message,
      };
    });
  };

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (resizeState) {
      return;
    }

    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }

    const wrapperRect = wrapper.getBoundingClientRect();
    const centerX = wrapperRect.left + styleConfig.position.x * wrapperRect.width;
    const centerY = wrapperRect.top + styleConfig.position.y * wrapperRect.height;

    dragDeltaRef.current = {
      x: event.clientX - centerX,
      y: event.clientY - centerY,
    };
    setIsDragging(true);
  };

  const startResize = (event: React.PointerEvent<HTMLDivElement>, handle: ResizeHandle) => {
    event.preventDefault();
    event.stopPropagation();

    setResizeState({
      handle,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: styleConfig.maxWidthRatio,
      startHeight: boxHeightRatio,
      startPosX: styleConfig.position.x,
      startPosY: styleConfig.position.y,
    });
  };

  const handleRender = async () => {
    if (!video) {
      return;
    }

    setRendering(true);
    setRenderStatus("创建渲染任务...");

    try {
      const { jobId } = await renderVideo(video.videoId, styleConfig);

      while (true) {
        const job = await getJob<{ outputUrl: string }>(jobId);
        if (job.status === "failed") {
          throw new Error(job.error ?? "渲染失败");
        }

        setRenderStatus(`渲染中：${Math.round(job.progress)}%`);

        if (job.status === "succeeded") {
          const output = job.result?.outputUrl ? { outputUrl: job.result.outputUrl } : await getOutput(video.videoId);
          setOutputUrl(output.outputUrl);
          setRenderStatus("渲染完成，可下载最终视频。");
          break;
        }

        await delay(1200);
      }
    } catch (error) {
      setRenderStatus(error instanceof Error ? error.message : "渲染失败");
    } finally {
      setRendering(false);
    }
  };


  const computedSubtitle = useMemo(() => {
    const baseText = activeCue?.text ?? "（播放视频后预览中文字幕，拖拽可调整位置和尺寸）";
    const horizontalPadding = 16;
    const verticalPadding = 16;
    const boxWidthPx = previewSize.width * styleConfig.maxWidthRatio - horizontalPadding;
    const boxHeightPx = previewSize.height * boxHeightRatio - verticalPadding;

    return fitSubtitleTextToBox({
      text: baseText,
      boxWidthPx,
      boxHeightPx,
      fontSize: styleConfig.fontSize,
    });
  }, [activeCue?.text, previewSize.width, previewSize.height, styleConfig.maxWidthRatio, boxHeightRatio, styleConfig.fontSize]);

  const subtitleBoxStyle: CSSProperties = {
    position: "absolute",
    left: `${styleConfig.position.x * 100}%`,
    top: `${styleConfig.position.y * 100}%`,
    transform: "translate(-50%, -50%)",
    width: `${styleConfig.maxWidthRatio * 100}%`,
    height: `${boxHeightRatio * 100}%`,
    border: "1px dashed rgba(255,255,255,0.9)",
    borderRadius: 8,
    padding: 8,
    background: "rgba(0,0,0,0.15)",
    cursor: isDragging ? "grabbing" : "grab",
    userSelect: "none",
  };

  const subtitleTextStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    overflow: "hidden",
    overflowWrap: "break-word",
    wordBreak: "break-word",
    whiteSpace: "pre-wrap",
    textAlign: styleConfig.textAlign,
    lineHeight: 1.25,
    color: styleConfig.fontColor,
    fontSize: styleConfig.fontSize,
    fontFamily: styleConfig.fontFamily,
    WebkitTextStroke: styleConfig.stroke.enabled ? `${styleConfig.stroke.width}px #000` : "0 transparent",
    textShadow: styleConfig.shadow.enabled ? `0 2px 6px rgba(0, 0, 0, ${styleConfig.shadow.opacity})` : "none",
  };

  const handleBaseStyle: CSSProperties = {
    position: "absolute",
    width: 12,
    height: 12,
    background: "#0ea5e9",
    border: "2px solid #fff",
    borderRadius: 3,
    zIndex: 2,
  };

  const handles: Array<{ handle: ResizeHandle; style: CSSProperties }> = [
    { handle: "n", style: { top: -6, left: "50%", transform: "translateX(-50%)", cursor: "ns-resize" } },
    { handle: "s", style: { bottom: -6, left: "50%", transform: "translateX(-50%)", cursor: "ns-resize" } },
    { handle: "e", style: { right: -6, top: "50%", transform: "translateY(-50%)", cursor: "ew-resize" } },
    { handle: "w", style: { left: -6, top: "50%", transform: "translateY(-50%)", cursor: "ew-resize" } },
    { handle: "ne", style: { right: -6, top: -6, cursor: "nesw-resize" } },
    { handle: "nw", style: { left: -6, top: -6, cursor: "nwse-resize" } },
    { handle: "se", style: { right: -6, bottom: -6, cursor: "nwse-resize" } },
    { handle: "sw", style: { left: -6, bottom: -6, cursor: "nesw-resize" } },
  ];

  const textAlignOptions: TextAlignMode[] = ["left", "center", "right"];

  if (loading) {
    return <div className="panel">加载中...</div>;
  }

  if (!video) {
    return <div className="panel">视频不存在</div>;
  }

  return (
    <div className="editor-grid">
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>字幕预览</h2>
        <div
          ref={wrapperRef}
          style={{
            position: "relative",
            width: "100%",
            background: "#000",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <video
            ref={videoRef}
            src={video.originalUrl}
            controls
            style={{ display: "block", width: "100%", height: "auto" }}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          />

          <div role="presentation" onPointerDown={startDrag} style={subtitleBoxStyle}>
            <div style={subtitleTextStyle}>{computedSubtitle.text}</div>
            {computedSubtitle.truncated ? (
              <div style={{ position: "absolute", right: 8, bottom: 6, fontSize: 11, color: "#f8fafc", opacity: 0.75 }}>…</div>
            ) : null}

            {handles.map((item) => (
              <div
                key={item.handle}
                role="presentation"
                onPointerDown={(event) => startResize(event, item.handle)}
                style={{
                  ...handleBaseStyle,
                  ...item.style,
                }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="panel" style={{ display: "grid", gap: 12, alignContent: "start" }}>
        <h2 style={{ marginTop: 0 }}>样式设置</h2>

        <SliderNumberControl
          fieldKey="fontSize"
          label="字体大小(px)"
          value={styleConfig.fontSize}
          min={12}
          max={120}
          step={1}
          decimals={0}
          errorMessage={errors.fontSize}
          onErrorChange={setError}
          onValueChange={(value) =>
            setStyleConfig((prev) => ({
              ...prev,
              fontSize: value,
            }))
          }
        />

        <SliderNumberControl
          fieldKey="positionX"
          label="X 位置"
          value={styleConfig.position.x}
          min={0}
          max={1}
          step={0.01}
          errorMessage={errors.positionX}
          onErrorChange={setError}
          onValueChange={(value) =>
            setStyleConfig((prev) => ({
              ...prev,
              position: {
                ...prev.position,
                x: clamp(value, prev.maxWidthRatio / 2, 1 - prev.maxWidthRatio / 2),
              },
            }))
          }
        />

        <SliderNumberControl
          fieldKey="positionY"
          label="Y 位置"
          value={styleConfig.position.y}
          min={0}
          max={1}
          step={0.01}
          errorMessage={errors.positionY}
          onErrorChange={setError}
          onValueChange={(value) =>
            setStyleConfig((prev) => ({
              ...prev,
              position: {
                ...prev.position,
                y: clamp(value, boxHeightRatio / 2, 1 - boxHeightRatio / 2),
              },
            }))
          }
        />

        <SliderNumberControl
          fieldKey="maxWidthRatio"
          label="字幕框宽度"
          value={styleConfig.maxWidthRatio}
          min={MIN_WIDTH_RATIO}
          max={MAX_WIDTH_RATIO}
          step={0.01}
          errorMessage={errors.maxWidthRatio}
          onErrorChange={setError}
          onValueChange={(value) =>
            setStyleConfig((prev) => ({
              ...prev,
              maxWidthRatio: value,
              position: {
                x: clamp(prev.position.x, value / 2, 1 - value / 2),
                y: prev.position.y,
              },
            }))
          }
        />

        <SliderNumberControl
          fieldKey="boxHeightRatio"
          label="字幕框高度"
          value={boxHeightRatio}
          min={MIN_HEIGHT_RATIO}
          max={MAX_HEIGHT_RATIO}
          step={0.01}
          errorMessage={errors.boxHeightRatio}
          onErrorChange={setError}
          onValueChange={(value) => {
            setBoxHeightRatio(value);
            setStyleConfig((prev) => ({
              ...prev,
              position: {
                x: prev.position.x,
                y: clamp(prev.position.y, value / 2, 1 - value / 2),
              },
            }));
          }}
        />

        <label style={{ display: "grid", gap: 6 }}>
          字体颜色
          <div className="row">
            <input
              type="color"
              value={styleConfig.fontColor}
              onChange={(event) =>
                setStyleConfig((prev) => ({
                  ...prev,
                  fontColor: event.target.value,
                }))
              }
            />
            <input
              type="text"
              value={styleConfig.fontColor}
              onChange={(event) => {
                const value = event.target.value;
                setStyleConfig((prev) => ({
                  ...prev,
                  fontColor: value,
                }));
                if (!/^#([0-9a-fA-F]{6})$/.test(value)) {
                  setError("fontColor", "请输入 #RRGGBB 格式颜色，例如 #ffffff");
                } else {
                  setError("fontColor");
                }
              }}
              onBlur={(event) => {
                const value = event.target.value;
                if (!/^#([0-9a-fA-F]{6})$/.test(value)) {
                  setStyleConfig((prev) => ({
                    ...prev,
                    fontColor: "#ffffff",
                  }));
                  setError("fontColor", "颜色已重置，允许范围为 #RRGGBB");
                }
              }}
            />
          </div>
          {errors.fontColor ? <span style={{ color: "var(--danger)", fontSize: 13 }}>{errors.fontColor}</span> : null}
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          对齐方式
          <div className="row">
            {textAlignOptions.map((align) => (
              <button
                key={align}
                type="button"
                className="btn"
                onClick={() =>
                  setStyleConfig((prev) => ({
                    ...prev,
                    textAlign: align,
                  }))
                }
                style={{
                  background: styleConfig.textAlign === align ? "var(--accent-dark)" : "#64748b",
                }}
              >
                {align === "left" ? "左对齐" : align === "center" ? "居中" : "右对齐"}
              </button>
            ))}
          </div>
        </label>

        <label className="row">
          <input
            type="checkbox"
            checked={styleConfig.stroke.enabled}
            onChange={(event) =>
              setStyleConfig((prev) => ({
                ...prev,
                stroke: {
                  ...prev.stroke,
                  enabled: event.target.checked,
                },
              }))
            }
          />
          描边
        </label>

        <SliderNumberControl
          fieldKey="strokeWidth"
          label="描边宽度"
          value={styleConfig.stroke.width}
          min={0}
          max={10}
          step={1}
          decimals={0}
          errorMessage={errors.strokeWidth}
          onErrorChange={setError}
          onValueChange={(value) =>
            setStyleConfig((prev) => ({
              ...prev,
              stroke: {
                ...prev.stroke,
                width: value,
              },
            }))
          }
        />

        <label className="row">
          <input
            type="checkbox"
            checked={styleConfig.shadow.enabled}
            onChange={(event) =>
              setStyleConfig((prev) => ({
                ...prev,
                shadow: {
                  ...prev.shadow,
                  enabled: event.target.checked,
                },
              }))
            }
          />
          阴影
        </label>

        <SliderNumberControl
          fieldKey="shadowOpacity"
          label="阴影强度"
          value={styleConfig.shadow.opacity}
          min={0}
          max={1}
          step={0.05}
          errorMessage={errors.shadowOpacity}
          onErrorChange={setError}
          onValueChange={(value) =>
            setStyleConfig((prev) => ({
              ...prev,
              shadow: {
                ...prev.shadow,
                opacity: value,
              },
            }))
          }
        />

        <label>
          字体族
          <input
            type="text"
            value={styleConfig.fontFamily}
            onChange={(event) =>
              setStyleConfig((prev) => ({
                ...prev,
                fontFamily: event.target.value,
              }))
            }
          />
        </label>

        <button className="btn" type="button" disabled={rendering || cues.length === 0} onClick={handleRender}>
          {rendering ? "渲染中..." : "生成最终视频"}
        </button>

        <p style={{ margin: 0, color: renderStatus.includes("失败") ? "var(--danger)" : "var(--text-muted)" }}>
          {renderStatus || "可先预览效果，再生成最终视频。"}
        </p>

        {outputUrl ? (
          <>
            <a href={outputUrl} target="_blank" rel="noreferrer">
              下载已烧录字幕视频
            </a>
            <button className="btn" type="button" onClick={() => router.push("/")}>
              继续上传
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
