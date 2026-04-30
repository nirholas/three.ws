// vite.config.js
import { defineConfig } from "file:///workspaces/3D-Agent/chat/node_modules/vite/dist/node/index.js";
import { svelte } from "file:///workspaces/3D-Agent/chat/node_modules/@sveltejs/vite-plugin-svelte/src/index.js";
import viteCompression from "file:///workspaces/3D-Agent/chat/node_modules/vite-plugin-compression/dist/index.mjs";
import path from "path";
var __vite_injected_original_dirname = "/workspaces/3D-Agent/chat";
var vite_config_default = defineConfig(function() {
  const buildTimestamp = /* @__PURE__ */ new Date();
  return {
    base: "/chat/",
    build: {
      outDir: "../public/chat",
      emptyOutDir: true
    },
    server: {
      // Forward /api requests to the 3D-Agent dev server (vercel dev on port 3000)
      proxy: {
        "/api": { target: "http://localhost:3000", changeOrigin: true }
      }
    },
    plugins: [
      svelte(),
      viteCompression({
        filter: /^(?!.*pdf\.worker\.min-[A-Z0-9]+\.mjs$).*\.(js|mjs|json|css|html)$/i
      })
    ],
    resolve: {
      alias: {
        "$src": path.resolve(__vite_injected_original_dirname, "./src")
      }
    },
    define: {
      "import.meta.env.BUILD_TIMESTAMP": JSON.stringify(buildTimestamp.toLocaleString())
    },
    optimizeDeps: {
      include: ["svelte-fast-dimension/action"]
    }
  };
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvd29ya3NwYWNlcy8zRC1BZ2VudC9jaGF0XCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvd29ya3NwYWNlcy8zRC1BZ2VudC9jaGF0L3ZpdGUuY29uZmlnLmpzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy93b3Jrc3BhY2VzLzNELUFnZW50L2NoYXQvdml0ZS5jb25maWcuanNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCB7IHN2ZWx0ZSB9IGZyb20gJ0BzdmVsdGVqcy92aXRlLXBsdWdpbi1zdmVsdGUnO1xuaW1wb3J0IHZpdGVDb21wcmVzc2lvbiBmcm9tICd2aXRlLXBsdWdpbi1jb21wcmVzc2lvbic7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKGZ1bmN0aW9uICgpIHtcblx0Y29uc3QgYnVpbGRUaW1lc3RhbXAgPSBuZXcgRGF0ZSgpO1xuXHRyZXR1cm4ge1xuXHRcdGJhc2U6ICcvY2hhdC8nLFxuXHRcdGJ1aWxkOiB7XG5cdFx0XHRvdXREaXI6ICcuLi9wdWJsaWMvY2hhdCcsXG5cdFx0XHRlbXB0eU91dERpcjogdHJ1ZSxcblx0XHR9LFxuXHRcdHNlcnZlcjoge1xuXHRcdFx0Ly8gRm9yd2FyZCAvYXBpIHJlcXVlc3RzIHRvIHRoZSAzRC1BZ2VudCBkZXYgc2VydmVyICh2ZXJjZWwgZGV2IG9uIHBvcnQgMzAwMClcblx0XHRcdHByb3h5OiB7XG5cdFx0XHRcdCcvYXBpJzogeyB0YXJnZXQ6ICdodHRwOi8vbG9jYWxob3N0OjMwMDAnLCBjaGFuZ2VPcmlnaW46IHRydWUgfSxcblx0XHRcdH0sXG5cdFx0fSxcblx0XHRwbHVnaW5zOiBbXG5cdFx0XHRzdmVsdGUoKSxcblx0XHRcdHZpdGVDb21wcmVzc2lvbih7XG5cdFx0XHRcdGZpbHRlcjogL14oPyEuKnBkZlxcLndvcmtlclxcLm1pbi1bQS1aMC05XStcXC5tanMkKS4qXFwuKGpzfG1qc3xqc29ufGNzc3xodG1sKSQvaSxcblx0XHRcdH0pLFxuXHRcdF0sXG5cdFx0cmVzb2x2ZToge1xuXHRcdFx0YWxpYXM6IHtcblx0XHRcdFx0JyRzcmMnOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi9zcmMnKSxcblx0XHRcdH1cblx0XHR9LFxuXHRcdGRlZmluZToge1xuXHRcdFx0J2ltcG9ydC5tZXRhLmVudi5CVUlMRF9USU1FU1RBTVAnOiBKU09OLnN0cmluZ2lmeShidWlsZFRpbWVzdGFtcC50b0xvY2FsZVN0cmluZygpKSxcblx0XHR9LFxuXHRcdG9wdGltaXplRGVwczoge1xuXHRcdFx0aW5jbHVkZTogWydzdmVsdGUtZmFzdC1kaW1lbnNpb24vYWN0aW9uJ10sXG5cdFx0fSxcblx0fTtcbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUE2UCxTQUFTLG9CQUFvQjtBQUMxUixTQUFTLGNBQWM7QUFDdkIsT0FBTyxxQkFBcUI7QUFDNUIsT0FBTyxVQUFVO0FBSGpCLElBQU0sbUNBQW1DO0FBS3pDLElBQU8sc0JBQVEsYUFBYSxXQUFZO0FBQ3ZDLFFBQU0saUJBQWlCLG9CQUFJLEtBQUs7QUFDaEMsU0FBTztBQUFBLElBQ04sTUFBTTtBQUFBLElBQ04sT0FBTztBQUFBLE1BQ04sUUFBUTtBQUFBLE1BQ1IsYUFBYTtBQUFBLElBQ2Q7QUFBQSxJQUNBLFFBQVE7QUFBQTtBQUFBLE1BRVAsT0FBTztBQUFBLFFBQ04sUUFBUSxFQUFFLFFBQVEseUJBQXlCLGNBQWMsS0FBSztBQUFBLE1BQy9EO0FBQUEsSUFDRDtBQUFBLElBQ0EsU0FBUztBQUFBLE1BQ1IsT0FBTztBQUFBLE1BQ1AsZ0JBQWdCO0FBQUEsUUFDZixRQUFRO0FBQUEsTUFDVCxDQUFDO0FBQUEsSUFDRjtBQUFBLElBQ0EsU0FBUztBQUFBLE1BQ1IsT0FBTztBQUFBLFFBQ04sUUFBUSxLQUFLLFFBQVEsa0NBQVcsT0FBTztBQUFBLE1BQ3hDO0FBQUEsSUFDRDtBQUFBLElBQ0EsUUFBUTtBQUFBLE1BQ1AsbUNBQW1DLEtBQUssVUFBVSxlQUFlLGVBQWUsQ0FBQztBQUFBLElBQ2xGO0FBQUEsSUFDQSxjQUFjO0FBQUEsTUFDYixTQUFTLENBQUMsOEJBQThCO0FBQUEsSUFDekM7QUFBQSxFQUNEO0FBQ0QsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
