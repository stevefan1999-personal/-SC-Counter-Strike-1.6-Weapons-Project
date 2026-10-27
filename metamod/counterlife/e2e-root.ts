// Prints the checkout directory of the metamod-p git dependency.
const manifest = Deno.args[0];
if (!manifest) {
  console.error("usage: e2e-root.ts <Cargo.toml>");
  Deno.exit(1);
}
const command = new Deno.Command("cargo", {
  args: ["metadata", "--format-version", "1", "--manifest-path", manifest],
  stdout: "piped",
  stderr: "inherit",
});
const output = await command.output();
if (!output.success) Deno.exit(output.code);
const meta = JSON.parse(new TextDecoder().decode(output.stdout));
const pkg = meta.packages.find((item: { name: string }) => item.name === "metamod-p");
if (!pkg) {
  console.error("metamod-p is not a dependency");
  Deno.exit(1);
}
console.log(String(pkg.manifest_path).replace(/[/\\]Cargo\.toml$/, ""));
