// rtf.js의 EMF · WMF 묶음(UMD) 타입 - 패키지 루트는 RTF 묶음까지 끌어오므로 묶음 파일을 직접 불러온다
declare module "rtf.js/dist/EMFJS.bundle.min.js" {
  export { Renderer } from "rtf.js/dist/src/emfjs/Renderer";
}
declare module "rtf.js/dist/WMFJS.bundle.min.js" {
  export { Renderer } from "rtf.js/dist/src/wmfjs/Renderer";
}
