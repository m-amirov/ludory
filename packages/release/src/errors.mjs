export class ReleaseInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReleaseInputError';
    this.code = code;
  }
}
