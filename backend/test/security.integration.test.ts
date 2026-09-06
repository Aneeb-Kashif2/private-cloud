import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import type { RedisService } from "../src/lib/redis.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const run = databaseUrl ? describe : describe.skip;
run("security integration", () => {
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl }); let app: FastifyInstance;
  const config:Config={NODE_ENV:"test",DATABASE_URL:databaseUrl!,REDIS_URL:"redis://localhost:6379",CACHE_TTL_SECONDS:60,STORAGE_PATH:"",AUTH_SECRET:"a".repeat(32),FRONTEND_ORIGIN:"http://localhost:3000",PORT:4000,STORAGE_LIMIT_BYTES:5368709120n,MAX_FILE_SIZE_BYTES:5368709120n,SESSION_TTL_DAYS:30};

  const cache=new Map<string,string>();
  const redis:RedisService={getJson:async<T>(key:string)=>cache.has(key)?JSON.parse(cache.get(key)!) as T:null,setJson:async(key,value)=>{cache.set(key,JSON.stringify(value))},del:async(...keys)=>{keys.forEach(key=>cache.delete(key))},close:async()=>undefined};
  beforeAll(async()=>{config.STORAGE_PATH=await mkdtemp(join(tmpdir(),"secure-cloud-integration-"));app=await buildApp({config,prisma,redis});await app.ready();await prisma.session.deleteMany();await prisma.file.deleteMany();await prisma.folder.deleteMany();await prisma.user.deleteMany()});
  afterAll(async()=>{await app.close();await prisma.$disconnect();await rm(config.STORAGE_PATH,{recursive:true,force:true})});
  const register=async(email:string)=>{const response=await app.inject({method:"POST",url:"/api/auth/register",headers:{origin:config.FRONTEND_ORIGIN},payload:{name:"Test User",email,password:"SecurePass1!",confirmPassword:"SecurePass1!"}});return{response,cookie:response.cookies[0]?.value,header:`selfcloud_session=${response.cookies[0]?.value}`}};
  it("registers a user and creates a root folder",async()=>{const {response}=await register("register@example.com");expect(response.statusCode).toBe(201);const user=await prisma.user.findUniqueOrThrow({where:{email:"register@example.com"},include:{folders:true}});expect(user.passwordHash).not.toContain("SecurePass1!");expect(user.folders.some(f=>f.isRoot)).toBe(true);expect(response.body).not.toContain("passwordHash")});
  it("logs in with a secure session cookie",async()=>{await register("login@example.com");const r=await app.inject({method:"POST",url:"/api/auth/login",headers:{origin:config.FRONTEND_ORIGIN},payload:{email:"login@example.com",password:"SecurePass1!"}});expect(r.statusCode).toBe(200);expect(r.headers["set-cookie"]).toContain("HttpOnly")});
  it("rejects unauthorized dashboard data access",async()=>{expect((await app.inject({method:"GET",url:"/api/storage"})).statusCode).toBe(401)});
  it("requires authorization before accepting uploads",async()=>{const r=await app.inject({method:"POST",url:"/api/files/upload",headers:{origin:config.FRONTEND_ORIGIN},payload:{filename:"a.pdf",size:2,mimeType:"application/pdf",folderId:"cm1234567890123456789012"}});expect(r.statusCode).toBe(401)});
  it("enforces the storage limit",async()=>{const u=await register("quota@example.com");const root=await prisma.folder.findFirstOrThrow({where:{user:{email:"quota@example.com"},isRoot:true}});const r=await app.inject({method:"POST",url:`/api/files/upload?filename=large.pdf&size=5368709121&mimeType=application/pdf&folderId=${root.id}`,headers:{cookie:u.header,origin:config.FRONTEND_ORIGIN,"content-type":"application/octet-stream"},payload:Buffer.alloc(0)});expect(r.statusCode).toBe(413)});
  async function completedFile(email:string,name:string,size=10){const u=await register(email);const user=await prisma.user.findUniqueOrThrow({where:{email}});const root=await prisma.folder.findFirstOrThrow({where:{userId:user.id,isRoot:true}});const done=await app.inject({method:"POST",url:`/api/files/upload?${new URLSearchParams({filename:name,size:String(size),mimeType:"application/pdf",folderId:root.id})}`,headers:{cookie:u.header,origin:config.FRONTEND_ORIGIN,"content-type":"application/octet-stream"},payload:Buffer.alloc(size,65)});expect(done.statusCode,done.body).toBe(201);return{...u,user,root,file:done.json().file}}
  it("lists only the current user's files",async()=>{const a=await completedFile("list-a@example.com","mine.pdf");await completedFile("list-b@example.com","theirs.pdf");const r=await app.inject({method:"GET",url:`/api/files?folderId=${a.root.id}`,headers:{cookie:a.header}});expect(r.json().files.map((f:{originalName:string})=>f.originalName)).toEqual(["mine.pdf"])});
  it("cannot download another user's file",async()=>{const owner=await completedFile("down-owner@example.com","private.pdf");const other=await register("down-other@example.com");expect((await app.inject({method:"GET",url:`/api/files/${owner.file.id}/download`,headers:{cookie:other.header}})).statusCode).toBe(404)});
  it("cannot delete another user's file",async()=>{const owner=await completedFile("delete-owner@example.com","private.pdf");const other=await register("delete-other@example.com");expect((await app.inject({method:"DELETE",url:`/api/files/${owner.file.id}`,headers:{cookie:other.header,origin:config.FRONTEND_ORIGIN}})).statusCode).toBe(404);expect(await prisma.file.findUnique({where:{id:owner.file.id}})).not.toBeNull()});
  it("increments storage only after verified completion",async()=>{const done=await completedFile("usage-up@example.com","file.pdf",75);const user=await prisma.user.findUniqueOrThrow({where:{id:done.user.id}});expect(user.storageUsed).toBe(75n);expect(user.storageReserved).toBe(0n)});
  it("decrements storage after filesystem and metadata deletion",async()=>{const done=await completedFile("usage-down@example.com","file.pdf",80);const r=await app.inject({method:"DELETE",url:`/api/files/${done.file.id}`,headers:{cookie:done.header,origin:config.FRONTEND_ORIGIN}});expect(r.statusCode).toBe(204);expect((await prisma.user.findUniqueOrThrow({where:{id:done.user.id}})).storageUsed).toBe(0n)});
  it("streams the original bytes and stores a private UUID path",async()=>{const done=await completedFile("bytes@example.com","../../private.pdf",12);expect(await readFile(join(config.STORAGE_PATH,done.file.storageKey))).toEqual(Buffer.alloc(12,65));const r=await app.inject({method:"GET",url:`/api/files/${done.file.id}/download`,headers:{cookie:done.header}});expect(r.statusCode).toBe(200);expect(r.rawPayload).toEqual(Buffer.alloc(12,65));expect(r.headers["content-disposition"]).toContain("attachment")});
  it("rejects concurrent reservations exceeding available quota",async()=>{const u=await register("concurrent@example.com");const user=await prisma.user.findUniqueOrThrow({where:{email:"concurrent@example.com"}});const root=await prisma.folder.findFirstOrThrow({where:{userId:user.id,isRoot:true}});await prisma.user.update({where:{id:user.id},data:{storageUsed:5368709110n}});const upload=()=>app.inject({method:"POST",url:`/api/files/upload?filename=a.pdf&size=10&mimeType=application/pdf&folderId=${root.id}`,headers:{cookie:u.header,origin:config.FRONTEND_ORIGIN,"content-type":"application/octet-stream"},payload:Buffer.alloc(10)});const responses=await Promise.all([upload(),upload()]);expect(responses.map(r=>r.statusCode).sort()).toEqual([201,413]);expect((await prisma.user.findUniqueOrThrow({where:{id:user.id}})).storageUsed).toBe(5368709120n)});
  it("releases quota and removes content after a size mismatch",async()=>{const u=await register("mismatch@example.com");const root=await prisma.folder.findFirstOrThrow({where:{user:{email:"mismatch@example.com"},isRoot:true}});const r=await app.inject({method:"POST",url:`/api/files/upload?filename=a.pdf&size=10&mimeType=application/pdf&folderId=${root.id}`,headers:{cookie:u.header,origin:config.FRONTEND_ORIGIN,"content-type":"application/octet-stream"},payload:Buffer.alloc(5)});expect(r.statusCode).toBe(409);const user=await prisma.user.findUniqueOrThrow({where:{email:"mismatch@example.com"}});expect(user.storageReserved).toBe(0n);expect(user.storageUsed).toBe(0n)});
  it("preserves search, type filters, name sorting and folder moves",async()=>{
    const owner=await completedFile("filters@example.com","zebra.pdf");
    const headers={cookie:owner.header,origin:config.FRONTEND_ORIGIN};
    const uploaded=await app.inject({method:"POST",url:`/api/files/upload?filename=alpha.pdf&size=1&mimeType=application/pdf&folderId=${owner.root.id}`,headers:{...headers,"content-type":"application/octet-stream"},payload:Buffer.from("a")});
    expect(uploaded.statusCode).toBe(201);
    const list=await app.inject({method:"GET",url:"/api/files?sort=name&order=asc&type=document",headers});
    expect(list.json().files.map((f:{originalName:string})=>f.originalName)).toEqual(["alpha.pdf","zebra.pdf"]);
    const search=await app.inject({method:"GET",url:"/api/files?search=ZEBRA",headers});expect(search.json().pagination.total).toBe(1);
    const folder=await app.inject({method:"POST",url:"/api/folders",headers,payload:{name:"Documents"}});expect(folder.statusCode).toBe(201);
    const folderId=folder.json().folder.id;
    expect((await app.inject({method:"PATCH",url:`/api/files/${owner.file.id}`,headers,payload:{folderId}})).statusCode).toBe(200);
    expect((await app.inject({method:"GET",url:`/api/files?folderId=${folderId}`,headers})).json().files[0].id).toBe(owner.file.id);
    expect((await app.inject({method:"DELETE",url:`/api/folders/${folderId}`,headers})).statusCode).toBe(409);
    await app.inject({method:"DELETE",url:`/api/files/${owner.file.id}`,headers});
    expect((await app.inject({method:"DELETE",url:`/api/folders/${folderId}`,headers})).statusCode).toBe(204);
  });
  it("retains metadata and usage on disk deletion failure",async()=>{
    const owner=await completedFile("disk-failure@example.com","file.pdf");
    const spy=vi.spyOn(app.storage,"remove").mockRejectedValueOnce(new Error("permission denied"));
    try {expect((await app.inject({method:"DELETE",url:`/api/files/${owner.file.id}`,headers:{cookie:owner.header,origin:config.FRONTEND_ORIGIN}})).statusCode).toBe(502)} finally {spy.mockRestore()}
    expect(await prisma.file.findUnique({where:{id:owner.file.id}})).not.toBeNull();
    expect((await prisma.user.findUniqueOrThrow({where:{id:owner.user.id}})).storageUsed).toBe(10n);
  });
  it("decrements usage only once for concurrent deletes",async()=>{
    const owner=await completedFile("double-delete@example.com","file.pdf");
    const remove=()=>app.inject({method:"DELETE",url:`/api/files/${owner.file.id}`,headers:{cookie:owner.header,origin:config.FRONTEND_ORIGIN}});
    const responses=await Promise.all([remove(),remove()]);expect(responses.every(r=>[204,404].includes(r.statusCode))).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({where:{id:owner.user.id}})).storageUsed).toBe(0n);
    await expect(readFile(join(config.STORAGE_PATH,owner.file.storageKey))).rejects.toMatchObject({code:"ENOENT"});
  });

});
