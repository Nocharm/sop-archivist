// 화면 코드가 CSS 변수(--z 같은)를 style로 넘길 수 있게 - 값의 모양은 CSS가 정한다.
import "react";

declare module "react" {
  interface CSSProperties {
    [key: `--${string}`]: string | number | undefined;
  }
}
