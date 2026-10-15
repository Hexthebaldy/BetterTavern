/** 请求面板：手机发来的每个请求一行（像浏览器开发者工具的“网络”）；点开看这个请求的所有记录 */

import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { HttpError, useRequest, useRequests } from "../api.ts";
import { ErrorBox, httpTone, IdChip, Loading, Notice, Pill, Seg } from "../components/common.tsx";
import { EntryRow, IdLink } from "../components/EntryRow.tsx";
import { errorCode, routeName } from "../lib/catalog.ts";
import { clock, duration, shortPath } from "../lib/format.ts";
import { mergeByTime } from "../lib/phone.ts";
import { usePhone } from "../phoneContext.tsx";

type Kind = "all" | "failed" | "slow";

export function Requests() {
  const [kind, setKind] = useState<Kind>("all");
  const { data, error, isLoading } = useRequests(kind);
  const navigate = useNavigate();
  const rows = data?.requests ?? [];
  const max = Math.max(1, ...rows.map((r) => r.duration_ms ?? 0));
  return (
    <div className="page">
      <div className="page-head">
        <h1>请求</h1>
        <Seg
          value={kind}
          onChange={setKind}
          options={[
            { value: "all", label: "全部" },
            { value: "failed", label: "失败的" },
            { value: "slow", label: "慢的（2 秒以上）" },
          ]}
        />
        <span className="mut small">新的在前；健康检查不显示</span>
      </div>
      {error ? <ErrorBox error={error} /> : null}
      {isLoading ? <Loading /> : null}
      {data && rows.length === 0 ? <div className="empty">没有符合条件的请求。</div> : null}
      {rows.length > 0 ? (
        <table className="list nowrap">
          <thead>
            <tr>
              <th>时间</th>
              <th>操作</th>
              <th>结果</th>
              <th>耗时</th>
              <th>用户</th>
              <th>单号</th>
              <th>回合</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.n} className="link" onClick={() => r.request_id && navigate(`/requests/${r.request_id}`)}>
                <td className="mono mut">{clock(r.t)}</td>
                <td>
                  {routeName(r.method, r.route, r.path)}
                  <div className="mono small mut" title={r.path ?? undefined}>
                    {r.method} {shortPath(r.path)}
                  </div>
                </td>
                <td>
                  <Pill tone={httpTone(r.status, r.aborted)}>{r.aborted ? "客户端断开" : (r.status ?? "?")}</Pill>
                  {r.error_code ? <div className="small mut">{errorCode(r.error_code)}</div> : null}
                </td>
                <td>
                  <div className="durbar">
                    <i style={{ width: `${((r.duration_ms ?? 0) / max) * 100}px` }} />
                    {duration(r.duration_ms)}
                  </div>
                </td>
                <td className="mono small mut">{r.user_ref ?? "–"}</td>
                <td>
                  <IdChip id={r.request_id} />
                </td>
                <td>
                  {r.turn_ids.map((t) => (
                    <Link key={t} to={`/turns/${t}`} onClick={(e) => e.stopPropagation()}>
                      <IdChip id={t} />
                    </Link>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

export function RequestDetail() {
  const { id = "" } = useParams();
  const { data, error, isLoading } = useRequest(id);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const { phone } = usePhone();
  const fromPhone = phone?.entries.filter((e) => e.request_id === id) ?? [];
  if (isLoading || (!data && !error)) return <Loading />;
  if (!data) {
    const missing = error instanceof HttpError && error.status === 404;
    return (
      <div className="page">
        <div className="crumbs">
          <Link to="/requests">请求</Link>
        </div>
        <div className="page-head">
          <h1>请求</h1>
          <IdChip id={id} length={16} />
        </div>
        {missing ? (
          <Notice tone="warn">
            服务端日志里没有这个单号。通常说明请求根本没到服务器（手机网络、服务器地址或端口不对），或者日志已经轮转删掉了。
          </Notice>
        ) : (
          <ErrorBox error={error} />
        )}
        {fromPhone.length > 0 ? (
          <>
            <h2>手机上的记录</h2>
            <div className="steps">
              {fromPhone.map((entry) => (
                <EntryRow key={entry.n} entry={entry} open onToggle={() => undefined} />
              ))}
            </div>
          </>
        ) : null}
      </div>
    );
  }
  const all = mergeByTime(data.entries, fromPhone);
  const req = data.request;
  const origin = all[0]?.t ?? null;
  return (
    <div className="page">
      <div className="crumbs">
        <Link to="/requests">请求</Link>
      </div>
      <div className="page-head">
        <h1>{req ? routeName(req.method, req.route, req.path) : "请求"}</h1>
        {req ? (
          <>
            <Pill tone={httpTone(req.status as number, Boolean(req.aborted))}>{String(req.status ?? "?")}</Pill>
            <span className="mut">
              {String(req.method ?? "")} {String(req.path ?? "")} · {duration(req.duration_ms as number)} ·{" "}
              {clock(req.t)}
            </span>
          </>
        ) : null}
        <IdChip id={id} length={16} />
      </div>
      {data.turn_ids.length > 0 ? (
        <p>
          涉及的回合：
          {data.turn_ids.map((t) => (
            <span key={t} style={{ marginRight: 10 }}>
              <IdLink kind="turn_id" id={t} />
            </span>
          ))}
        </p>
      ) : null}
      <h2>
        这个请求的全部记录{" "}
        <span className="mut small">
          {all.length} 条{fromPhone.length > 0 ? `，其中 ${fromPhone.length} 条来自手机` : ""}
        </span>
      </h2>
      <div className="steps">
        {all.map((entry) => (
          <EntryRow
            key={entry.n}
            entry={entry}
            origin={origin}
            open={open.has(entry.n)}
            onToggle={() =>
              setOpen((prev) => {
                const next = new Set(prev);
                if (next.has(entry.n)) next.delete(entry.n);
                else next.add(entry.n);
                return next;
              })
            }
          />
        ))}
      </div>
    </div>
  );
}
