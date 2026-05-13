// chromedriver npm package ships JS only; declare the single field we
// use so the import type-checks without an @types/* dep.
declare module 'chromedriver' {
  const path: string;
  export { path };
  export default { path };
}
