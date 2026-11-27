export function validateResult(
  result: unknown,
  record: {
    id: string;
    originals: {
      id?: string;
      name: string;
      hash: string;
      pageCount?: number;
    }[];
  },
  atDate?: string,
): unknown;
