/**
 * SSH 远程执行；若提供 sudoPassword，则通过 `sudo -S bash -lc` 以 root 执行内层命令（密码走 stdin，等价非交互 sudo 提权）
 */
export async function execSshCommand(ssh, command, sudoPassword) {
  const cmd = String(command ?? '');
  const pw = sudoPassword != null ? String(sudoPassword) : '';
  if (!pw) {
    return ssh.execCommand(cmd);
  }
  const inner = JSON.stringify(cmd);
  const shell = `printf '%s\\n' ${JSON.stringify(pw)} | sudo -S bash -lc ${inner}`;
  return ssh.execCommand(shell);
}
