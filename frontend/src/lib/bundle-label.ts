// Bundle 표시 이름 - 한 줄로만 보일 자리(상단 막대·토스트·확인 모달)가 쓴다. 이름 없이 만든 Bundle은 코드로 보인다.

export function getBundleLabel(bundle: { code: string; title: string }): string {
  return bundle.title.trim() || bundle.code;
}
