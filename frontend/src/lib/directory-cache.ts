// 직원 디렉터리 전체 - 세션당 한 번 받아 모듈에 둔다(피커가 브라우저에서 순위를 매긴다). 실패하면 비워 다음 마운트가 다시 받고,
// 로그아웃·사용자 전환 때 비운다(묶음 캐시와 같은 지점).
import { listDirectoryAll, type DirectoryUser } from "@/lib/api";

let cache: DirectoryUser[] | null = null;
let inflight: Promise<DirectoryUser[]> | null = null;

export function loadDirectoryOnce(): Promise<DirectoryUser[]> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = listDirectoryAll()
      .then((people) => {
        cache = people;
        return people;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function clearDirectoryCache(): void {
  cache = null;
  inflight = null;
}
