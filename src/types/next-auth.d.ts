import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      /** 社員番号。人事アプリの利用許可名簿（jinji_admins）との突合キー */
      loginId: string;
      name?: string | null;
      email?: string | null;
      companyId: string;
      companyName: string;
    };
  }

  interface User {
    id: string;
    loginId: string;
    companyId: string;
    companyName: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    loginId: string;
    companyId: string;
    companyName: string;
  }
}
