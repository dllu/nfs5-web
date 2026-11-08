// The supplied patch's NoMovies option skips the opening helper. The original
// recompiled helper preserves the native patch's jump and stack effects,
// avoiding runtime modification of translated code.
export const verokImage='c318af393d4c2b7071a820ca3d69e956bbd94769b6e5c2e3e49f498ecbc94906';
export function openingMovies(bytes) {
  if(!bytes)return true;
  const encoding=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===239&&bytes[1]===187&&bytes[2]===191?'utf-8':'windows-1252';
  let section='',enabled=true;
  for(const raw of new TextDecoder(encoding).decode(bytes).split(/\r?\n/)) {
    const line=raw.trim();if(!line||line[0]===';'||line[0]==='#')continue;
    const header=/^\[([^\]]+)\]/.exec(line);
    if(header){section=header[1].trim().toLowerCase();continue;}
    const pair=/^([^=]+)=(.*)$/.exec(line);
    if(section==='nfs5'&&pair&&pair[1].trim().toLowerCase()==='nomovies') {
      const value=pair[2].trim().replace(/^"(.*)"$/,'$1');enabled=!(Number.parseInt(value,10)||0);
    }
  }
  return enabled;
}
