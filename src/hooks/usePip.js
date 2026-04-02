import { useCallback, useEffect, useRef, useState } from "react";

function copyDocumentStyles(sourceDoc, targetDoc) {
  for (const styleSheet of Array.from(sourceDoc.styleSheets)) {
    try {
      if (styleSheet.href) {
        const link = targetDoc.createElement("link");
        link.rel = "stylesheet";
        link.href = styleSheet.href;
        targetDoc.head.appendChild(link);
        continue;
      }

      const cssRules = Array.from(styleSheet.cssRules || [])
        .map((rule) => rule.cssText)
        .join("\n");
      if (!cssRules) continue;

      const style = targetDoc.createElement("style");
      style.textContent = cssRules;
      targetDoc.head.appendChild(style);
    } catch {
      // Cross-origin stylesheets can throw; ignore and continue.
    }
  }
}

export default function usePip(options = {}) {
  const { width = 420, height = 320, title = "Floating Window" } = options;

  const [pipWindow, setPipWindow] = useState(null);
  const [mountNode, setMountNode] = useState(null);
  const [isOpen, setIsOpen] = useState(false);

  const pipWindowRef = useRef(null);
  const detachRef = useRef(null);

  const isSupported =
    typeof window !== "undefined" && "documentPictureInPicture" in window;

  const detach = useCallback(() => {
    if (detachRef.current) {
      detachRef.current();
      detachRef.current = null;
    }
    pipWindowRef.current = null;
    setPipWindow(null);
    setMountNode(null);
    setIsOpen(false);
  }, []);

  const closePip = useCallback(() => {
    const current = pipWindowRef.current;
    if (!current || current.closed) {
      detach();
      return;
    }
    current.close();
    detach();
  }, [detach]);

  const openPip = useCallback(async () => {
    if (!isSupported) return null;

    const current = pipWindowRef.current;
    if (current && !current.closed) {
      current.focus();
      return current;
    }

    const pip = await window.documentPictureInPicture.requestWindow({
      width,
      height,
    });

    pip.document.title = title;
    copyDocumentStyles(document, pip.document);

    pip.document.documentElement.style.width = "100%";
    pip.document.documentElement.style.height = "100%";
    pip.document.body.style.margin = "0";
    pip.document.body.style.width = "100%";
    pip.document.body.style.height = "100%";
    pip.document.body.style.overflow = "hidden";

    pip.document.body.innerHTML = "";
    const container = pip.document.createElement("div");
    container.id = "pip-root";
    container.style.width = "100%";
    container.style.height = "100%";
    pip.document.body.appendChild(container);

    const onPageHide = () => {
      detach();
    };

    pip.addEventListener("pagehide", onPageHide, { once: true });
    detachRef.current = () => {
      pip.removeEventListener("pagehide", onPageHide);
    };

    pipWindowRef.current = pip;
    setPipWindow(pip);
    setMountNode(container);
    setIsOpen(true);
    return pip;
  }, [detach, height, isSupported, title, width]);

  useEffect(() => {
    return () => {
      closePip();
    };
  }, [closePip]);

  return {
    isSupported,
    isOpen,
    pipWindow,
    mountNode,
    openPip,
    closePip,
  };
}
