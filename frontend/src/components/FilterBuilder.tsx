import {
  FIELD_DEFS,
  fieldDef,
  newCondition,
  emptyGroup,
  operatorsFor,
  type FilterCondition,
  type FilterGroup,
} from "../filters/filterModel";

// Recursive AND/OR group editor. The tree is owned by the parent (Browse); every change
// produces a new tree via structural sharing-free clone (small trees, simplicity wins).

interface GroupProps {
  group: FilterGroup;
  onChange: (g: FilterGroup) => void;
  onRemove?: () => void;
  depth: number;
}

export default function FilterBuilder({ group, onChange, onRemove, depth }: GroupProps) {
  const update = (i: number, item: FilterCondition | FilterGroup) => {
    const conditions = [...group.conditions];
    conditions[i] = item;
    onChange({ ...group, conditions });
  };
  const remove = (i: number) => {
    onChange({ ...group, conditions: group.conditions.filter((_, x) => x !== i) });
  };

  return (
    <div
      className={`rounded-md border ${
        depth === 0 ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-50"
      } p-3`}
    >
      <div className="mb-2 flex items-center gap-2">
        <div className="flex rounded-md border border-slate-300 text-xs">
          {(["AND", "OR"] as const).map((op) => (
            <button
              key={op}
              onClick={() => onChange({ ...group, op })}
              className={`px-2.5 py-1 first:rounded-l-md last:rounded-r-md ${
                group.op === op ? "bg-accent text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {op}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-400">
          {group.op === "AND" ? "all conditions match" : "any condition matches"}
        </span>
        {onRemove && (
          <button
            onClick={onRemove}
            className="ml-auto text-xs text-slate-400 hover:text-red-600"
          >
            Remove group
          </button>
        )}
      </div>

      <div className="space-y-2">
        {group.conditions.map((c, i) =>
          c.kind === "group" ? (
            <FilterBuilder
              key={i}
              group={c}
              depth={depth + 1}
              onChange={(g) => update(i, g)}
              onRemove={() => remove(i)}
            />
          ) : (
            <ConditionRow
              key={i}
              condition={c}
              onChange={(cc) => update(i, cc)}
              onRemove={() => remove(i)}
            />
          )
        )}
      </div>

      <div className="mt-2 flex gap-3 text-xs">
        <button
          onClick={() =>
            onChange({ ...group, conditions: [...group.conditions, newCondition()] })
          }
          className="text-accent hover:underline"
        >
          + condition
        </button>
        {depth < 3 && (
          <button
            onClick={() =>
              onChange({
                ...group,
                conditions: [
                  ...group.conditions,
                  { ...emptyGroup(), op: group.op === "AND" ? "OR" : "AND", conditions: [newCondition()] },
                ],
              })
            }
            className="text-accent hover:underline"
          >
            + nested group
          </button>
        )}
      </div>
    </div>
  );
}

function ConditionRow({
  condition,
  onChange,
  onRemove,
}: {
  condition: FilterCondition;
  onChange: (c: FilterCondition) => void;
  onRemove: () => void;
}) {
  const def = fieldDef(condition.field);
  const ops = operatorsFor(condition.field, true);
  const noValue = ["is_null", "is_not_null"].includes(condition.operator);
  const isList = ["in", "not_in"].includes(condition.operator);
  const isBetween = condition.operator === "between";

  const setField = (field: string) => {
    const nextOps = operatorsFor(field, true);
    const operator = nextOps.some((o) => o.op === condition.operator)
      ? condition.operator
      : nextOps[0]!.op;
    onChange({ ...condition, field, operator, value: "" });
  };

  const setOperator = (operator: string) => {
    let value = condition.value;
    if (operator === "between" && !Array.isArray(value)) value = ["", ""];
    if (operator !== "between" && Array.isArray(value) && !isListOp(operator)) value = "";
    onChange({ ...condition, operator, value });
  };

  const inputType = def.type === "number" ? "number" : def.type === "date" ? "date" : "text";
  const inputCls =
    "rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-accent focus:outline-none";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={condition.field}
        onChange={(e) => setField(e.target.value)}
        className={inputCls}
      >
        {FIELD_DEFS.map((f) => (
          <option key={f.field} value={f.field}>
            {f.label}
          </option>
        ))}
      </select>

      <select
        value={condition.operator}
        onChange={(e) => setOperator(e.target.value)}
        className={inputCls}
      >
        {ops.map((o) => (
          <option key={o.op} value={o.op}>
            {o.label}
          </option>
        ))}
      </select>

      {!noValue && isBetween && (
        <>
          <input
            type={inputType}
            value={String((condition.value as unknown[])?.[0] ?? "")}
            onChange={(e) =>
              onChange({
                ...condition,
                value: [coerce(def.type, e.target.value), (condition.value as unknown[])?.[1] ?? ""],
              })
            }
            className={`${inputCls} w-32`}
          />
          <span className="text-xs text-slate-400">and</span>
          <input
            type={inputType}
            value={String((condition.value as unknown[])?.[1] ?? "")}
            onChange={(e) =>
              onChange({
                ...condition,
                value: [(condition.value as unknown[])?.[0] ?? "", coerce(def.type, e.target.value)],
              })
            }
            className={`${inputCls} w-32`}
          />
        </>
      )}

      {!noValue && isList && (
        <input
          type="text"
          placeholder="comma-separated values"
          value={Array.isArray(condition.value) ? (condition.value as string[]).join(", ") : ""}
          onChange={(e) =>
            onChange({
              ...condition,
              value: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
                .map((s) => coerce(def.type, s)),
            })
          }
          className={`${inputCls} w-64`}
        />
      )}

      {!noValue && !isList && !isBetween && (
        <input
          type={inputType}
          step={def.type === "number" ? "any" : undefined}
          value={String(condition.value ?? "")}
          onChange={(e) => onChange({ ...condition, value: coerce(def.type, e.target.value) })}
          className={`${inputCls} w-56`}
        />
      )}

      <button
        onClick={onRemove}
        aria-label="remove condition"
        className="text-xs text-slate-400 hover:text-red-600"
      >
        remove
      </button>
    </div>
  );
}

function isListOp(op: string): boolean {
  return op === "in" || op === "not_in";
}

function coerce(type: string, raw: string): unknown {
  if (type === "number" && raw !== "" && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}
