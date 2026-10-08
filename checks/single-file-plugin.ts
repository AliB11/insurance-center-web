import type { Plugin } from 'vite';

/** This app has one HTML entry; inline only its emitted JS/CSS, without glob dependencies. */
export function singleFile(): Plugin {
  return {
    name: 'insurance-single-file',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = bundle['index.html'];
      if (!html || html.type !== 'asset') this.error('Expected index.html');
      let source = String(html.source);
      const inlined: string[] = [];
      source = source.replace(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g, (tag, path: string) => {
        const key = path.replace(/^\.\//, '');
        const chunk = bundle[key];
        if (!chunk || chunk.type !== 'chunk') return tag;
        inlined.push(key);
        return `<script type="module">${chunk.code.replace(/<\/script/gi, '<\\/script')}</script>`;
      });
      source = source.replace(/<link\b[^>]*\bhref="([^"]+)"[^>]*>/g, (tag, path: string) => {
        const key = path.replace(/^\.\//, '');
        const asset = bundle[key];
        if (!key.endsWith('.css') || !asset || asset.type !== 'asset') return tag;
        inlined.push(key);
        return `<style>${String(asset.source).replace(/<\/style/gi, '<\\/style')}</style>`;
      });
      html.source = source;
      for (const key of inlined) delete bundle[key];
      if (Object.values(bundle).some((item) => item.type === 'chunk')) this.error('Uninlined JavaScript in single-file build');
    },
  };
}
