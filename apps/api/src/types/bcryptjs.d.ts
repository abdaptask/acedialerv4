// Local type declarations for bcryptjs, since npm workspace hoisting
// can prevent the @types/bcryptjs package from being resolved on Render.
declare module 'bcryptjs' {
  export function hash(data: string, saltOrRounds: string | number): Promise<string>;
  export function compare(data: string, encrypted: string): Promise<boolean>;
  export function hashSync(data: string, saltOrRounds: string | number): string;
  export function compareSync(data: string, encrypted: string): boolean;
  export function genSalt(rounds?: number): Promise<string>;
  export function genSaltSync(rounds?: number): string;
  const _default: {
    hash: typeof hash;
    compare: typeof compare;
    hashSync: typeof hashSync;
    compareSync: typeof compareSync;
    genSalt: typeof genSalt;
    genSaltSync: typeof genSaltSync;
  };
  export default _default;
}
