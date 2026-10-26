// Print the Character Creator code for the prototype's rest-pose spec.
import { createServer } from 'vite';
const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } });
const S = await server.ssrLoadModule('/src/figure/characterSpec.ts');
const C = await server.ssrLoadModule('/src/figure/characterCodegen.ts');
const spec = S.cloneSpec(S.DEFAULT_SPEC);
spec.base = false; spec.place = false;
console.log(C.specToCode(spec));
await server.close();
