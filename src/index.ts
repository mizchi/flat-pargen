enum Kind {
  SEQ = 1,
  REPEAT,
  EXPR,
  OR,
}

type Parser<In = any, Out = any> = (input: In) => Out;
type NodeBase<In = any, Out = any> = {
  reshape: Parser<In, Out>;
  key: string | void;
};

export type Node<In = any, Out = any> =
  | Seq<In, Out>
  | Expr<Out>
  | Or<In, Out>
  | Repeat<In, Out>;

export type Seq<In = any, Out = any> = NodeBase<In, Out> & {
  kind: Kind.SEQ;
  children: Node<In, Out>[];
};

export type Repeat<In = any, Out = any> = NodeBase<In, Out> & {
  kind: Kind.REPEAT;
  pattern: Node<In, Out>;
};

export type Or<In = any, Out = any> = NodeBase<In, Out> & {
  kind: Kind.OR;
  patterns: Array<Seq | Expr>;
};

export type Expr<Out = any> = NodeBase<string, Out> & {
  kind: Kind.EXPR;
  expr: string;
};

const concat = <T>(items: T[], fn: (t: T) => string) =>
  items.reduce((acc: string, item: T) => acc + fn(item), "");

const defaultReshape: Parser<any, any> = <T>(i: T): T => i;

function createSeq(children: Expr[], reshape: Parser = defaultReshape): Seq {
  return {
    kind: Kind.SEQ,
    children,
    reshape,
    key: undefined,
  };
}

function createOr(
  patterns: Array<Seq | Expr>,
  reshape: Parser = defaultReshape
): Or {
  return {
    kind: Kind.OR,
    patterns,
    key: undefined,
    reshape,
  };
}

function createRepeat(
  pattern: Node,
  reshape: Parser<any, any> = defaultReshape
): Repeat {
  return {
    kind: Kind.REPEAT,
    pattern,
    reshape,
    key: undefined,
  };
}

function createExpr(
  expr: string,
  reshape: Parser<any, any> = defaultReshape
): Expr {
  return {
    kind: Kind.EXPR,
    expr,
    reshape,
    key: undefined,
  };
}

export const $ = {
  expr: createExpr,
  repeat: createRepeat,
  or: createOr,
  seq: createSeq,
  param<T extends Node>(key: string, node: T): T {
    return { ...node, key };
  },
  join(...expr: string[]): Expr {
    return createExpr(expr.join(""));
  },
};

// serialize
function serializeToFlatRegex(node: Node): string {
  switch (node.kind) {
    case Kind.EXPR: {
      return node.expr;
    }
    case Kind.OR: {
      const patterns = node.patterns.map(serializeToFlatRegex);
      return "(" + patterns.join("|") + ")";
    }
    case Kind.REPEAT: {
      const pattern = serializeToFlatRegex(node.pattern);
      return `(${pattern}){0,}`;
    }
    case Kind.SEQ: {
      return concat(node.children, serializeToFlatRegex);
    }
    default: {
      throw new Error("WIP expr and parser");
    }
  }
}

function serializeToGroupRegex(seq: Seq): string {
  return seq.children.reduce((acc, child) => {
    const flat = serializeToFlatRegex(child);
    if (child.key) {
      return `${acc}(?<${child.key}>${flat})`;
    }
    return `${acc}${flat}`;
  }, "");
}

export function compile(node: Node): Parser<string, any> {
  const reshape = node.reshape;
  switch (node.kind) {
    case Kind.EXPR: {
      const re = new RegExp(`^${serializeToFlatRegex(node)}`);
      return (input: string) => {
        const m = re.exec(input);
        if (m == null) return;
        return reshape(input);
      };
    }
    case Kind.OR: {
      const compiledPatterns = node.patterns.map((p) => {
        return {
          parse: compile(p),
          re: new RegExp(`^${serializeToFlatRegex(p)}`),
        };
      });
      return (input: string) => {
        for (const next of compiledPatterns) {
          const m = next.re.exec(input);
          if (m == null) continue;
          const result = next.parse(input);
          if (result) {
            return reshape(result);
          }
        }
        return null;
      };
    }
    case Kind.SEQ: {
      const re = new RegExp(`^${serializeToGroupRegex(node)}`);
      const composedParser = node.children.reduce(
        (parent: Parser<any, any>, next: Node) => {
          if (next.key == null) return parent;
          const childParser = compile(next);
          return (result: any) =>
            parent({
              ...result,
              [next.key!]: childParser(result[next.key!]),
            });
        },
        (result: any) => result
      );
      return (input: string = "") => {
        const m = input.match(re);
        if (m == null) return;
        const full = m[0];
        if (m.groups) {
          return reshape(composedParser(m.groups));
        }
        return reshape(composedParser(full));
      };
    }
    case Kind.REPEAT: {
      const re = new RegExp(`^${serializeToFlatRegex(node.pattern)}`);
      const parser = compile(node.pattern);
      return (input: string) => {
        const xs: string[] = [];
        while (input.length > 0) {
          const m = input.match(re);
          if (m == null) break;
          const full = m[0];
          xs.push(full);
          input = input.slice(full.length);
        }
        return node.reshape(xs.map(parser) as any);
      };
    }
    default: {
      throw new Error("WIP expr and parser");
    }
  }
}

// test
