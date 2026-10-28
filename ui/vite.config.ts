import { defineConfig } from 'vite'

// base 必须是相对路径：页面是从 https://appassets.sdlmdcomment/ 加载的，
// 绝对路径 /assets/... 会对到虚拟主机的根，虽然也行，但相对路径在 file:// 调试时同样能用
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome110',
    assetsDir: 'assets',
    // 关掉内容 hash：插件按固定文件名加载，也方便把 dist 写进包清单
    rollupOptions: {
      output: {
        entryFileNames: 'app.js',
        chunkFileNames: '[name].js',
        assetFileNames: 'app.[ext]',
      },
    },
  },
})
