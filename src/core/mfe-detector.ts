import { URL } from 'url';
import { Logger } from '../utils/logger.js';
import { saveJsonFile } from '../utils/file-system.js';
import { join } from 'path';
import { readFile } from 'fs/promises';

interface PageSnapshot {
  title: string;
  url: string;
  dom: string;
  scriptUrls: string[];
}

interface MfeInfo {
  name: string;
  scripts: string[];
}

interface MfeAnalysis {
  shell: string;
  mfes: MfeInfo[];
}

interface DomainGroup {
  domain: string;
  scripts: string[];
  hasRemoteEntry: boolean;
  hasWebpackSharing: boolean;
}

/**
 * Extract domain from a URL
 */
function getDomain(urlString: string): string {
  try {
    const url = new URL(urlString);
    return `${url.protocol}//${url.host}`;
  } catch {
    // If URL parsing fails, try to extract domain manually
    const match = urlString.match(/^(https?:\/\/[^\/]+)/);
    return match ? match[1] : urlString;
  }
}

/**
 * Check if a script URL indicates Module Federation
 */
function isModuleFederationScript(scriptUrl: string): boolean {
  const urlLower = scriptUrl.toLowerCase();
  
  // Check for remoteEntry.js (primary indicator)
  if (urlLower.includes('remoteentry.js')) {
    return true;
  }
  
  // Check for __webpack_init_sharing__ pattern
  // This is typically in webpack sharing chunks
  if (urlLower.includes('__webpack_init_sharing__') || 
      urlLower.includes('webpack_sharing')) {
    return true;
  }
  
  return false;
}

/**
 * Group scripts by domain and detect MFE patterns
 */
function groupScriptsByDomain(scriptUrls: string[]): Map<string, DomainGroup> {
  const domainGroups = new Map<string, DomainGroup>();
  
  for (const scriptUrl of scriptUrls) {
    const domain = getDomain(scriptUrl);
    
    if (!domainGroups.has(domain)) {
      domainGroups.set(domain, {
        domain,
        scripts: [],
        hasRemoteEntry: false,
        hasWebpackSharing: false,
      });
    }
    
    const group = domainGroups.get(domain)!;
    group.scripts.push(scriptUrl);
    
    // Check for Module Federation indicators
    if (isModuleFederationScript(scriptUrl)) {
      if (scriptUrl.toLowerCase().includes('remoteentry.js')) {
        group.hasRemoteEntry = true;
      }
      if (scriptUrl.toLowerCase().includes('webpack_sharing') || 
          scriptUrl.toLowerCase().includes('__webpack_init_sharing__')) {
        group.hasWebpackSharing = true;
      }
    }
  }
  
  return domainGroups;
}

/**
 * Determine shell domain (primary domain)
 * Logic: Shell is typically the domain without remoteEntry.js, or the one with the most scripts
 */
function determineShell(domainGroups: Map<string, DomainGroup>, pageUrl: string): string {
  const pageDomain = getDomain(pageUrl);
  
  // If page domain exists and doesn't have remoteEntry, it's likely the shell
  const pageDomainGroup = domainGroups.get(pageDomain);
  if (pageDomainGroup && !pageDomainGroup.hasRemoteEntry) {
    return pageDomain;
  }
  
  // Otherwise, find the domain without remoteEntry (most likely shell)
  for (const [domain, group] of domainGroups) {
    if (!group.hasRemoteEntry) {
      return domain;
    }
  }
  
  // Fallback: domain with most scripts
  let maxScripts = 0;
  let shellDomain = pageDomain;
  
  for (const [domain, group] of domainGroups) {
    if (group.scripts.length > maxScripts) {
      maxScripts = group.scripts.length;
      shellDomain = domain;
    }
  }
  
  return shellDomain;
}

/**
 * Detect MFE architecture from page snapshot
 */
export function detectMfe(snapshot: PageSnapshot): MfeAnalysis {
  Logger.info('Detecting Module Federation architecture...');
  
  // Group scripts by domain
  const domainGroups = groupScriptsByDomain(snapshot.scriptUrls);
  
  Logger.info(`Found ${domainGroups.size} unique domain(s)`);
  
  // Determine shell (primary domain)
  const shell = determineShell(domainGroups, snapshot.url);
  Logger.info(`Shell domain: ${shell}`);
  
  // Identify remote MFEs (domains with remoteEntry.js)
  const mfes: MfeInfo[] = [];
  
  for (const [domain, group] of domainGroups) {
    // Skip shell domain
    if (domain === shell) {
      continue;
    }
    
    // If domain has remoteEntry, it's an MFE
    if (group.hasRemoteEntry || group.hasWebpackSharing) {
      // Extract MFE name from domain (e.g., localhost:3001 -> mfe-3001)
      const mfeName = extractMfeName(domain);
      
      mfes.push({
        name: mfeName,
        scripts: group.scripts,
      });
      
      Logger.info(`Detected MFE: ${mfeName} (${domain})`);
    }
  }
  
  return {
    shell,
    mfes,
  };
}

/**
 * Extract a readable name from domain
 */
function extractMfeName(domain: string): string {
  try {
    const url = new URL(domain);
    const hostname = url.hostname;
    const port = url.port;
    
    // If it's localhost with port, use port as identifier
    if (hostname === 'localhost' && port) {
      return `mfe-${port}`;
    }
    
    // Otherwise use hostname
    return hostname.replace(/\./g, '-');
  } catch {
    // Fallback: use domain as-is, sanitized
    return domain.replace(/[^a-zA-Z0-9-]/g, '-');
  }
}

/**
 * Analyze page snapshot and save MFE analysis
 */
export async function analyzeMfe(snapshotPath?: string): Promise<void> {
  try {
    // Read page snapshot
    const snapshotFilePath = snapshotPath || join(process.cwd(), 'outputs', 'page-snapshot.json');
    Logger.info(`Reading page snapshot from: ${snapshotFilePath}`);
    
    const snapshotContent = await readFile(snapshotFilePath, 'utf-8');
    const snapshot: PageSnapshot = JSON.parse(snapshotContent);
    
    // Detect MFE architecture
    const analysis = detectMfe(snapshot);
    
    // Save analysis
    const outputPath = join(process.cwd(), 'outputs', 'mfe-analysis.json');
    Logger.info(`Saving MFE analysis to: ${outputPath}`);
    await saveJsonFile(outputPath, analysis);
    
    Logger.success('MFE analysis completed successfully');
    Logger.info(`Shell: ${analysis.shell}`);
    Logger.info(`Remote MFEs: ${analysis.mfes.length}`);
    
  } catch (error) {
    Logger.error('MFE analysis failed:', error);
    throw error;
  }
}
