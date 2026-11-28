import {it,expect} from "vitest";
// @ts-ignore native shared server helper
import {appOrigins} from "../server/origins.mjs";
it("allows only exact platform deployment hostnames and existing production origins",()=>{
 const origins=appOrigins({VERCEL_URL:"forestwom-reviewed-261.vercel.app",VERCEL_BRANCH_URL:"forestwom-git-reviewed-261.vercel.app"});
 expect(origins).toContain("https://forestwom-reviewed-261.vercel.app");
 expect(origins).toContain("https://forestwom.2hayoung.com");
 expect(origins).not.toContain("https://other.vercel.app");
 for(const host of ["evil.example","forestwom.vercel.app.evil.example","forestwom.vercel.app/path","https://forestwom.vercel.app"])
  expect(appOrigins({VERCEL_URL:host})).toHaveLength(2);
});
