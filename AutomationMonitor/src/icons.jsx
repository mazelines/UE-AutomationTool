import React from "react";

function Svg({ size = 17, sw = 1.9, fill = "none", stroke = "currentColor", children, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth={sw} {...rest}>
      {children}
    </svg>
  );
}

export const IconLogo = () => (
  <Svg stroke="#08130d" sw={2.4}>
    <path d="M12 2 3 7v10l9 5 9-5V7z" />
    <path d="M12 22V12M3 7l9 5 9-5" />
  </Svg>
);

export const IconOverview = () => (
  <Svg>
    <rect x="3" y="3" width="7" height="9" rx="1.4" />
    <rect x="14" y="3" width="7" height="5" rx="1.4" />
    <rect x="14" y="12" width="7" height="9" rx="1.4" />
    <rect x="3" y="16" width="7" height="5" rx="1.4" />
  </Svg>
);

export const IconPipeline = () => (
  <Svg>
    <circle cx="5" cy="6" r="2.4" />
    <circle cx="5" cy="18" r="2.4" />
    <circle cx="19" cy="12" r="2.4" />
    <path d="M5 8.4v7.2M7.3 6h6.4a3 3 0 0 1 3 3v.6M7.3 18h6.4a3 3 0 0 0 3-3v-.6" />
  </Svg>
);

export const IconDeploy = () => (
  <Svg>
    <path d="M4.5 15.5 9 11l4 4 6.5-6.5" />
    <path d="M12 22c4-2 7-6 7-12V4l-7-2-7 2v6c0 6 3 10 7 12Z" />
  </Svg>
);

export const IconLogs = () => (
  <Svg>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M7 9l3 2.5L7 14M12.5 14h4" />
  </Svg>
);

export const IconBell = () => (
  <Svg>
    <path d="M18 8A6 6 0 1 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </Svg>
);

export const IconRepoTree = () => (
  <Svg size={15} stroke="var(--text-mute)">
    <path d="M3 7l9-4 9 4-9 4-9-4zM3 12l9 4 9-4M3 17l9 4 9-4" />
  </Svg>
);

export const IconBranch = () => (
  <Svg size={13} sw={2} stroke="var(--accent)">
    <circle cx="6" cy="6" r="2.4" />
    <circle cx="6" cy="18" r="2.4" />
    <path d="M6 8.4v7.2M18 8v8" />
    <circle cx="18" cy="6" r="2.4" />
    <path d="M8 6h6a4 4 0 0 1 4 4" />
  </Svg>
);

export const IconSun = () => (
  <Svg>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
);

export const IconMoon = () => (
  <Svg>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </Svg>
);

export const IconClock = ({ stroke = "var(--success)" }) => (
  <Svg size={18} stroke={stroke}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);

export const IconPlay = () => (
  <Svg size={14} fill="currentColor" stroke="none">
    <path d="M7 5v14l12-7z" />
  </Svg>
);

export const IconStop = () => (
  <Svg size={14} fill="currentColor" stroke="none">
    <rect x="6" y="6" width="12" height="12" rx="1.5" />
  </Svg>
);

export const IconDownload = () => (
  <Svg size={13} sw={2}>
    <path d="M12 3v12M7 10l5 5 5-5M4 21h16" />
  </Svg>
);

export const IconCheck = ({ size = 13 }) => (
  <Svg size={size} sw={2.4}>
    <path d="M5 13l4 4L19 7" />
  </Svg>
);

export const IconFolder = ({ size = 15 }) => (
  <Svg size={size} sw={1.8}>
    <path d="M3 7a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.5.7L11.2 7H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Svg>
);
