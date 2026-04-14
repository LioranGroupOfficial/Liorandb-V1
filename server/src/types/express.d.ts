declare namespace Express {
  export interface Request {
    user?: import("./auth-user").RequestAuthContext;
  }
}
