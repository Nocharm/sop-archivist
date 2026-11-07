// 받은 파일을 브라우저 내려받기로 넘긴다 - 인증 헤더가 필요한 파일은 apiFetchBlob으로 받은 뒤 이것으로 저장한다.

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // 클릭 처리 뒤에 놓는다 - 바로 놓으면 일부 브라우저가 받기 전에 주소를 잃는다
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
