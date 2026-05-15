import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b0b10",
        paper: "#f4f0e6",
        neon: "#ff2a87",
        cyan: "#21f1ff",
        acid: "#d9ff3c",
      },
      fontFamily: {
        display: ["VT323", "ui-monospace", "monospace"],
        mono: ["Space Mono", "ui-monospace", "monospace"],
      },
      animation: {
        breath: "breath 2.4s ease-in-out infinite",
        stride: "stride 0.46s ease-in-out infinite",
        "leg-front": "legFront 0.46s ease-in-out infinite",
        "leg-back": "legBack 0.46s ease-in-out infinite",
        "arm-swing": "armSwing 0.46s ease-in-out infinite",
        "spin-slow": "spin 8s linear infinite",
        "pulse-dot": "pulse 1.6s ease-in-out infinite",
      },
      keyframes: {
        breath: {
          "0%,100%": { transform: "translateY(0) scaleY(1)" },
          "50%": { transform: "translateY(-1px) scaleY(0.98)" },
        },
        stride: {
          "0%,100%": { transform: "translateY(0)" },
          "25%": { transform: "translateY(-4px)" },
          "50%": { transform: "translateY(0)" },
          "75%": { transform: "translateY(-4px)" },
        },
        legFront: {
          "0%,100%": { transform: "rotate(-26deg)" },
          "50%": { transform: "rotate(26deg)" },
        },
        legBack: {
          "0%,100%": { transform: "rotate(26deg)" },
          "50%": { transform: "rotate(-26deg)" },
        },
        armSwing: {
          "0%,100%": { transform: "rotate(15deg)" },
          "50%": { transform: "rotate(-15deg)" },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
