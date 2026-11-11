// 목록 한 벌을 표와 밀도 높은 카드 두 보기로 그린다 - 열 정의 하나로 둘 다 만든다. 보기 전환은 ListViewToggle, 기억은 use-list-view.ts.
// 카드 자리: title(첫 줄 왼쪽) · badge(첫 줄 오른쪽) · body(제목 아래 전체 폭) · meta(라벨 값, 기본) · actions(카드 아래 오른쪽, 호버로 드러남 - cardActions="row"면 맨 아래 한 줄) · none(표만)
"use client";

import { LayoutGrid, Rows3 } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { LoadMoreRows } from "@/components/ui/load-more";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";
import { getRowOpenProps } from "@/lib/row-open";
import { setListView, type ListView } from "@/lib/use-list-view";

export type CardSlot = "title" | "badge" | "body" | "meta" | "actions" | "none";

export interface DataColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  card?: CardSlot;
  /** 카드 meta 라벨 - 비우면 header */
  cardLabel?: ReactNode;
  align?: "start" | "end";
  /** 남은 폭을 채우는 열 - 긴 글이 표를 옆으로 밀지 않고 칸 안에서 줄을 바꾸거나 말줄임한다 */
  grow?: boolean;
  minWidth?: number;
  nowrap?: boolean;
  /** 불러오는 동안 쉬머 폭(px) */
  skeletonWidth?: number;
  cellTestId?: (row: T) => string | undefined;
  /** 표 칸(td·th)에만 덧붙이는 배치 */
  className?: string;
}

interface DataListProps<T> {
  view: ListView;
  /** null이면 불러오는 중 */
  rows: readonly T[] | null;
  columns: readonly DataColumn<T>[];
  getRowKey: (row: T) => string | number;
  /** 표·카드 묶음 자체의 testid */
  testId: string;
  rowTestId: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** 줄 안에 같은 곳으로 가는 링크가 이미 있다 - 줄 자체는 Tab 순서에 넣지 않는다(같은 곳에 두 번 서지 않게) */
  hasRowLink?: boolean;
  /** 줄에 덧붙이는 식별용 data 속성(스모크가 읽는 값 등) */
  getRowData?: (row: T) => Record<`data-${string}`, string>;
  /** 옆 칸에 내용을 펼쳐 보는 목록에서 지금 고른 줄 */
  isRowSelected?: (row: T) => boolean;
  showSkeleton?: boolean;
  skeletonRows?: number;
  more?: { hasMore: boolean; sentinelRef: (node: Element | null) => void; testId: string };
  /** 카드 한 장의 최소 폭(px) - 화면 폭에 맞춰 열 수가 정해진다 */
  cardMinWidth?: number;
  /** 카드 묶음 둘레 여백을 뺀다 - 이미 여백이 있는 패널 안에 둘 때 */
  flush?: boolean;
  /** 패널 안 목록 - 표는 테두리 상자에 담고 카드는 둘레 여백 없이 둔다 */
  framed?: boolean;
  /** 줄을 구역으로 나눈다 - 같은 구역 줄이 rows 안에서 붙어 있어야 한다. 구역이 시작하는 줄 앞에 머리(라벨·줄 수)를 그린다 */
  getRowGroup?: (row: T) => RowGroup;
  /** 카드의 동작 단추 자리 - 기본 overlay(오른쪽 아래에 겹쳐 뜸), row는 카드 맨 아래 한 줄을 차지하고 늘 보인다 */
  cardActions?: "overlay" | "row";
}

export interface RowGroup {
  key: string;
  label: ReactNode;
}

const DEFAULT_SKELETON_WIDTH = 96;

export function DataList<T>(props: DataListProps<T>) {
  if (props.view === "cards") return <CardGrid {...props} />;
  return props.framed ? (
    <div className="dlist-frame dense">
      <Table {...props} />
    </div>
  ) : (
    <Table {...props} />
  );
}

// 누르면 열리는 줄의 속성 - 안에 링크가 없으면 키보드로도 닿게 한다
function getRowHandlers<T>(onRowClick: ((row: T) => void) | undefined, hasRowLink: boolean, row: T) {
  if (!onRowClick) return undefined;
  return hasRowLink ? { onClick: () => onRowClick(row) } : getRowOpenProps(() => onRowClick(row));
}

// 이 줄에서 새 구역이 시작하면 그 구역과 줄 수를 준다
function getGroupStart<T>(rows: readonly T[], index: number, getRowGroup: ((row: T) => RowGroup) | undefined): (RowGroup & { count: number }) | null {
  if (!getRowGroup) return null;
  const group = getRowGroup(rows[index]);
  if (index > 0 && getRowGroup(rows[index - 1]).key === group.key) return null;
  return { ...group, count: rows.filter((row) => getRowGroup(row).key === group.key).length };
}

function GroupHead({ label, count }: { label: ReactNode; count: number }) {
  return (
    <span className="dgroup-head">
      {label}
      <span className="dgroup-n">{count}</span>
    </span>
  );
}

function getCellClass<T>(column: DataColumn<T>): string {
  return [column.align === "end" ? "num" : "", column.nowrap ? "whitespace-nowrap" : "", column.grow ? "dl-grow" : "", column.card === "title" ? "dl-title" : "", column.className ?? ""]
    .filter(Boolean)
    .join(" ");
}

function Table<T>({ rows, columns, getRowKey, testId, rowTestId, getRowData, onRowClick, hasRowLink = false, isRowSelected, showSkeleton = false, skeletonRows = 3, more, getRowGroup }: DataListProps<T>) {
  return (
    <table className="dtable" data-testid={testId}>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key} className={getCellClass(column)} style={column.minWidth ? { minWidth: column.minWidth } : undefined}>
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows === null
          ? showSkeleton &&
            Array.from({ length: skeletonRows }, (_, index) => (
              <tr key={index} data-testid={`${testId}-skeleton`}>
                {columns.map((column) => (
                  <td key={column.key}>
                    <span className="sk h-5" style={{ width: column.skeletonWidth ?? DEFAULT_SKELETON_WIDTH, maxWidth: "100%" }} />
                  </td>
                ))}
              </tr>
            ))
          : rows.flatMap((row, index) => {
              const group = getGroupStart(rows, index, getRowGroup);
              return [
                group && (
                  <tr key={`group-${group.key}`} className="dgroup" data-testid={`${testId}-group-${group.key}`}>
                    <td colSpan={columns.length}>
                      <GroupHead label={group.label} count={group.count} />
                    </td>
                  </tr>
                ),
              <tr
                key={getRowKey(row)}
                className={isRowSelected?.(row) ? "bg-sel" : undefined}
                aria-selected={isRowSelected ? isRowSelected(row) : undefined}
                {...getRowData?.(row)}
                data-testid={rowTestId(row)}
                data-link={onRowClick ? "" : undefined}
                {...getRowHandlers(onRowClick, hasRowLink, row)}
              >
                {columns.map((column) => (
                  <td key={column.key} className={getCellClass(column)} data-testid={column.cellTestId?.(row)}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>,
              ];
            })}
        {rows !== null && more?.hasMore && <LoadMoreRows sentinelRef={more.sentinelRef} columns={columns.length} testId={more.testId} />}
      </tbody>
    </table>
  );
}

function CardGrid<T>({ rows, columns, getRowKey, testId, rowTestId, getRowData, onRowClick, hasRowLink = false, isRowSelected, showSkeleton = false, skeletonRows = 3, more, cardMinWidth = 300, flush = false, framed = false, getRowGroup, cardActions = "overlay" }: DataListProps<T>) {
  const slot = (column: DataColumn<T>): CardSlot => column.card ?? "meta";
  const pick = (name: CardSlot) => columns.filter((column) => slot(column) === name);
  const titles = pick("title");
  const badges = pick("badge");
  const bodies = pick("body");
  const metas = pick("meta");
  const actions = pick("actions");
  const style = { "--card-min": `${cardMinWidth}px` } as CSSProperties;

  return (
    <div className={flush || framed ? "dcards flush" : "dcards"} data-testid={testId} style={style}>
      {rows === null
        ? showSkeleton &&
          Array.from({ length: skeletonRows * 2 }, (_, index) => <CardSkeleton key={index} testId={`${testId}-skeleton`} />)
        : rows.flatMap((row, index) => {
            const group = getGroupStart(rows, index, getRowGroup);
            return [
              group && (
                <div key={`group-${group.key}`} className="dgroup" data-testid={`${testId}-group-${group.key}`}>
                  <GroupHead label={group.label} count={group.count} />
                </div>
              ),
            <article
              key={getRowKey(row)}
              className={cardActions === "row" ? "dcard has-foot" : "dcard hover-row"}
              data-selected={isRowSelected?.(row) ? "" : undefined}
              {...getRowData?.(row)}
              data-testid={rowTestId(row)}
              data-link={onRowClick ? "" : undefined}
              {...getRowHandlers(onRowClick, hasRowLink, row)}
            >
              {(titles.length > 0 || badges.length > 0) && (
                <div className="dcard-head">
                  <div className="dcard-title">
                    {titles.map((column) => (
                      <div key={column.key} data-testid={column.cellTestId?.(row)}>
                        {column.cell(row)}
                      </div>
                    ))}
                  </div>
                  {badges.length > 0 && (
                    <div className="dcard-badges">
                      {badges.map((column) => (
                        <span key={column.key} data-testid={column.cellTestId?.(row)}>
                          {column.cell(row)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {bodies.map((column) => (
                <div key={column.key} className="dcard-body" data-testid={column.cellTestId?.(row)}>
                  {column.cell(row)}
                </div>
              ))}
              {metas.length > 0 && (
                <dl className="dcard-meta">
                  {metas.map((column) => (
                    <div key={column.key}>
                      <dt>{column.cardLabel ?? column.header}</dt>
                      <dd data-testid={column.cellTestId?.(row)}>{column.cell(row)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {actions.length > 0 && (
                <div className={cardActions === "row" ? "dcard-foot" : "dcard-actions row-actions"}>
                  {actions.map((column) => (
                    <span key={column.key} data-testid={column.cellTestId?.(row)}>
                      {column.cell(row)}
                    </span>
                  ))}
                </div>
              )}
            </article>,
            ];
          })}
      {rows !== null &&
        more?.hasMore &&
        [0, 1].map((index) => (
          <CardSkeleton key={`more-${index}`} sentinelRef={index === 0 ? more.sentinelRef : undefined} testId={index === 0 ? more.testId : undefined} />
        ))}
    </div>
  );
}

function CardSkeleton({ testId, sentinelRef }: { testId?: string; sentinelRef?: (node: Element | null) => void }) {
  return (
    <div ref={sentinelRef} className="dcard" data-testid={testId} aria-hidden>
      <span className="sk h-5 w-3/5" />
      <span className="sk h-4 w-4/5" />
      <span className="sk h-4 w-2/5" />
    </div>
  );
}

interface ListViewToggleProps {
  listKey: string;
  view: ListView;
  testId: string;
}

/** 목록 머리의 표·카드 전환 - 고른 보기는 listKey마다 이 브라우저에 남는다 */
export function ListViewToggle({ listKey, view, testId }: ListViewToggleProps) {
  const { t } = useI18n();
  const options: { value: ListView; label: string; icon: ReactNode }[] = [
    { value: "table", label: t("list.viewTable"), icon: <Rows3 size={14} strokeWidth={1.5} aria-hidden /> },
    { value: "cards", label: t("list.viewCards"), icon: <LayoutGrid size={14} strokeWidth={1.5} aria-hidden /> },
  ];
  return (
    <div className="view-toggle" role="group" aria-label={t("list.view")} data-testid={testId}>
      {options.map((option) => (
        <Tooltip key={option.value} label={option.label}>
          <button
            type="button"
            aria-pressed={view === option.value}
            aria-label={option.label}
            data-testid={`${testId}-${option.value}`}
            onClick={() => setListView(listKey, option.value)}
          >
            {option.icon}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
