#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// 获取当前文件的目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 目标目录
const postsDir = path.join(rootDir, 'src', 'content', 'posts');
const imagesDir = path.join(rootDir, 'src', 'assets', 'images');

// 生成 abbrlink
function generateAbbrlink(content) {
  const hash = crypto.createHash('md5').update(content).digest('hex');
  return hash.substring(0, 8);
}

// 获取第一个 h1 标题
function getFirstH1Title(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

// 获取今天的日期，格式为 yyyy-mm-dd
function getTodayDate() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 获取文件的创建日期
function getFileCreationDate(filePath) {
  try {
    const stats = fs.statSync(filePath);
    const date = new Date(stats.birthtime);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch (err) {
    console.error(`无法获取文件创建日期：${err.message}`);
    return getTodayDate();
  }
}

// 根据文件创建日期生成目录路径 (yyyy/mm)
function getDateBasedDirectory(filePath) {
  // 如果提供了文件路径，使用文件创建日期
  if (filePath && fs.existsSync(filePath)) {
    try {
      const stats = fs.statSync(filePath);
      const date = new Date(stats.birthtime);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      return `${year}/${month}`;
    } catch (err) {
      console.warn(`无法获取文件创建日期：${err.message}，使用当前日期`);
    }
  }

  // 如果没有提供文件路径或获取创建日期失败，使用当前日期
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}/${month}`;
}

// 处理Markdown内容中的图片
function processImages(content, sourcePath, abbrlink) {
  let processedContent = content;
  const sourceDir = path.dirname(sourcePath);
  const imageMappings = new Map();
  const imagePromises = [];
  let imageCount = 0;

  // 处理 Markdown 图片引用格式 ![alt](path)
  const mdImagePattern = /!\[(.*?)\]\(([^)]+)\)/g;
  let mdMatch;
  while ((mdMatch = mdImagePattern.exec(content)) !== null) {
    const [fullMatch, altText, imgPath] = mdMatch;

    // 跳过外部链接和数据 URL
    if (imgPath.startsWith('http://') ||
        imgPath.startsWith('https://') ||
        imgPath.startsWith('data:')) {
      continue;
    }

    // 解析图片路径（相对于源文件目录）
    const absoluteImgPath = path.isAbsolute(imgPath)
      ? imgPath
      : path.resolve(sourceDir, imgPath);

    // 检查图片是否存在
    if (!fs.existsSync(absoluteImgPath)) {
      console.warn(`警告: 图片 ${absoluteImgPath} 不存在`);
      continue;
    }

    // 创建图片的新路径
    const newImgInfo = prepareImageCopy(absoluteImgPath, abbrlink);

    // 准备复制图片
    imagePromises.push(() => copyImage(absoluteImgPath, newImgInfo.path));

    // 保存图片映射关系，稍后替换内容
    imageMappings.set(fullMatch, `![${altText}](/src/assets/images/posts/${abbrlink}/${newImgInfo.name})`);
    imageCount++;
  }

  // 处理 HTML img 标签格式 <img src="path" alt="alt" />
  const htmlImagePattern = /<img\s+[^>]*?src=["']([^"']+)["'][^>]*?>/gi;
  let htmlMatch;
  while ((htmlMatch = htmlImagePattern.exec(content)) !== null) {
    const [fullMatch, imgPath] = htmlMatch;

    // 跳过外部链接和数据 URL
    if (imgPath.startsWith('http://') ||
        imgPath.startsWith('https://') ||
        imgPath.startsWith('data:')) {
      continue;
    }

    // 解析图片路径（相对于源文件目录）
    const absoluteImgPath = path.isAbsolute(imgPath)
      ? imgPath
      : path.resolve(sourceDir, imgPath);

    // 检查图片是否存在
    if (!fs.existsSync(absoluteImgPath)) {
      console.warn(`警告: 图片 ${absoluteImgPath} 不存在`);
      continue;
    }

    // 创建图片的新路径
    const newImgInfo = prepareImageCopy(absoluteImgPath, abbrlink);

    // 准备复制图片
    imagePromises.push(() => copyImage(absoluteImgPath, newImgInfo.path));

    // 提取 alt 文本
    const altMatch = fullMatch.match(/alt=["']([^"']*)["']/i);
    const altText = altMatch ? altMatch[1] : '';

    // 构建新的 img 标签，保留原有的其他属性
    let newImgTag = fullMatch.replace(
      /src=["'][^"']+["']/i,
      `src="/src/assets/images/posts/${abbrlink}/${newImgInfo.name}"`
    );

    // 保存图片映射关系，稍后替换内容
    imageMappings.set(fullMatch, newImgTag);
    imageCount++;
  }

  // 执行所有图片复制操作
  imagePromises.forEach(copyFn => copyFn());

  // 替换内容中的图片路径
  for (const [oldPath, newPath] of imageMappings.entries()) {
    processedContent = processedContent.replace(oldPath, newPath);
  }

  return {
    content: processedContent,
    imageCount: imageCount
  };
}

// 准备图片复制信息
function prepareImageCopy(absoluteImgPath, abbrlink) {
  const imgExt = path.extname(absoluteImgPath);
  const imgBasename = path.basename(absoluteImgPath, imgExt);
  const imgHash = crypto.createHash('md5').update(imgBasename).digest('hex').substring(0, 8);
  const newImgName = `${abbrlink}-${imgHash}${imgExt}`;
  const newImgDir = path.join(imagesDir, 'posts', abbrlink);
  const newImgPath = path.join(newImgDir, newImgName);

  return {
    name: newImgName,
    dir: newImgDir,
    path: newImgPath
  };
}

// 复制图片文件
function copyImage(source, destination) {
  // 确保目标目录存在
  const destDir = path.dirname(destination);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  // 复制图片
  fs.copyFileSync(source, destination);
  console.log(`成功: 图片已复制到 ${destination}`);
}

// 处理Markdown内容，替换特定语法
function processMarkdownContent(content, skipFormatting = false) {
  // 如果跳过格式处理，直接返回原内容
  if (skipFormatting) {
    return content;
  }

  let processedContent = content;

  // 替换 ==xxx== 为 <mark>xxx</mark>
  processedContent = processedContent.replace(/==([^=]+)==/g, '<mark>$1</mark>');

  // 替换 !!!xxx!!! 为 <kbd>xxx</kbd> (键盘样式)
  processedContent = processedContent.replace(/!!!([^!]+)!!!/g, '<kbd>$1</kbd>');

  // 替换 ~~xxx~~ 为 <s>xxx</s>，如果尚未使用此语法
  processedContent = processedContent.replace(/~~([^~]+)~~/g, '<s>$1</s>');

  // 替换 ^xxx^ 为 <sup>xxx</sup> (上标)
  processedContent = processedContent.replace(/\^([^\^]+)\^/g, '<sup>$1</sup>');

  // 替换 ~xxx~ 为 <sub>xxx</sub> (下标)
  processedContent = processedContent.replace(/~([^~]+)~/g, '<sub>$1</sub>');

  // 替换 ++xxx++ 为 <ins>xxx</ins> (插入文本)
  processedContent = processedContent.replace(/\+\+([^+]+)\+\+/g, '<ins>$1</ins>');

  return processedContent;
}

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2);

  // 默认命令是 'add'（添加新文章）
  let command = 'add';

  // 如果第一个参数不以'-'开头，则视为子命令
  if (args.length > 0 && !args[0].startsWith('-')) {
    command = args.shift();
  }

  const parsedArgs = {
    command,          // 子命令：add, update, check, cleanup
    sourcePath: null, // 文件路径
    subdirectory: null, // 子目录
    tags: [],         // 标签
    title: null,      // 标题
    published: null,  // 发布日期
    toc: true,        // 是否生成目录
    lang: 'zh',       // 语言
    abbrlink: null,   // 文章短链接
    oldAbbrlink: null, // 原文章短链接
    updateImageLinks: false, // 是否更新图片链接
    skipFormatting: false, // 是否跳过格式处理
    force: false,     // 是否强制执行（不询问确认）
    verbose: false,    // 是否启用详细模式
    help: false       // 是否显示帮助
  };

  // 处理常规参数
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      parsedArgs.help = true;
      continue;
    }

    if (arg === '--force' || arg === '-f') {
      parsedArgs.force = true;
      continue;
    }

    if (arg === '--verbose' || arg === '-v') {
      parsedArgs.verbose = true;
      continue;
    }

    // 处理带值的参数
    if ((arg.startsWith('--') || (arg.startsWith('-') && arg.length === 2)) && i + 1 < args.length) {
      let paramName;
      if (arg.startsWith('--')) {
        paramName = arg.slice(2);
      } else {
        // 短选项映射
        const shortOptionMap = {
          's': 'source',
          'd': 'dir',
          't': 'tags',
          'a': 'abbrlink',
          'o': 'old-abbrlink'
        };
        paramName = shortOptionMap[arg.slice(1)] || arg.slice(1);
      }

      const nextArg = args[i + 1];
      if (!nextArg.startsWith('-')) {
        i++;

        switch (paramName) {
          case 'source':
          case 'file':
            parsedArgs.sourcePath = nextArg;
            break;
          case 'dir':
          case 'subdirectory':
          case 'subdir':
            parsedArgs.subdirectory = nextArg;
            break;
          case 'tags':
            parsedArgs.tags = nextArg.split(',').map(tag => tag.trim());
            break;
          case 'title':
            parsedArgs.title = nextArg;
            break;
          case 'date':
          case 'published':
            parsedArgs.published = nextArg;
            break;
          case 'toc':
            parsedArgs.toc = nextArg.toLowerCase() === 'true';
            break;
          case 'lang':
            parsedArgs.lang = nextArg;
            break;
          case 'abbrlink':
          case 'link':
            parsedArgs.abbrlink = nextArg;
            break;
          case 'old-abbrlink':
          case 'old':
            parsedArgs.oldAbbrlink = nextArg;
            break;
          case 'skip-formatting':
            parsedArgs.skipFormatting = nextArg.toLowerCase() === 'true';
            break;
        }
      }
    } else if (arg === '--update-image-links') {
      parsedArgs.updateImageLinks = true;
    } else if (arg === '--skip-formatting') {
      parsedArgs.skipFormatting = true;
    } else if (arg === '--toc') {
      parsedArgs.toc = true;
    } else if (!parsedArgs.sourcePath && !arg.startsWith('-')) {
      // 第一个非选项参数视为源文件路径
      parsedArgs.sourcePath = arg;
    } else if (!parsedArgs.subdirectory && !arg.startsWith('-')) {
      // 第二个非选项参数视为子目录
      parsedArgs.subdirectory = arg;
    } else if (parsedArgs.tags.length === 0 && !arg.startsWith('-')) {
      // 第三个非选项参数视为标签列表
      parsedArgs.tags = arg.split(',').map(tag => tag.trim());
    }
  }

  // 如果同时指定了 oldAbbrlink 和 abbrlink，启用更新图片链接功能
  if (parsedArgs.oldAbbrlink && parsedArgs.abbrlink) {
    parsedArgs.updateImageLinks = true;
  }

  // 根据命令设置默认值
  if (command === 'add' && !parsedArgs.subdirectory) {
    parsedArgs.subdirectory = getDateBasedDirectory(parsedArgs.sourcePath);
  }

  return parsedArgs;
}

// 主函数
async function main() {
  const args = parseArgs();

  if (args.help) {
    showHelp(args.command);
    return;
  }

  try {
    switch (args.command) {
      case 'add':
        // 添加新文章
        if (!args.sourcePath) {
          console.error('错误: 未指定源文件路径');
          showHelp('add');
          return;
        }
        await processMarkdownFile(args);
        break;

      case 'update':
        // 更新文章
        if (!args.sourcePath) {
          console.error('错误: 未指定源文件路径');
          showHelp('update');
          return;
        }
        // 强制启用图片链接更新
        args.updateImageLinks = true;
        await processMarkdownFile(args);
        break;

      case 'check':
        // 检查图片链接
        await checkImageLinks(args);
        break;

      case 'cleanup':
        // 清理未引用的图片
        await cleanupImages(args);
        break;

      default:
        console.error(`错误: 未知命令 "${args.command}"`);
        showHelp();
    }
  } catch (error) {
    console.error(`执行过程中出错: ${error.message}`);
    process.exit(1);
  }
}

// 检查图片链接
async function checkImageLinks(options) {
  const startDir = options.sourcePath ? path.dirname(options.sourcePath) : postsDir;
  const mdFiles = options.sourcePath ? [options.sourcePath] : getAllMarkdownFiles(startDir);

  console.log('正在检查图片链接...');
  let updatedCount = 0;
  let updatedDateCount = 0;

  for (const mdFile of mdFiles) {
    const content = fs.readFileSync(mdFile, 'utf8');
    const abbrMatch = content.match(/abbrlink:\s*([^\s\n]+)/);

    if (!abbrMatch) {
      console.warn(`警告: 文件 ${mdFile} 没有找到 abbrlink`);
      continue;
    }

    const abbrlink = abbrMatch[1];

    // 检查图片链接
    const { needsUpdate, oldLinks } = checkImagePathsInContent(content, abbrlink);

    // 检查是否需要更新 updated 字段
    const needsUpdateDate = checkAndUpdateModifiedDate(mdFile, content);

    if (needsUpdate || needsUpdateDate) {
      let updatedContent = content;

      if (needsUpdate) {
        console.log(`文件 ${path.relative(rootDir, mdFile)} 包含不匹配的图片链接`);

        if (options.force || await confirmAction(`是否自动修复图片链接？(y/N) `)) {
          updatedContent = updateImagePaths(updatedContent, oldLinks, abbrlink);
          updatedCount++;
        }
      }

      if (needsUpdateDate) {
        console.log(`文件 ${path.relative(rootDir, mdFile)} 需要更新修改日期`);

        if (options.force || await confirmAction(`是否更新修改日期？(y/N) `)) {
          updatedContent = updateModifiedDate(mdFile, updatedContent);
          updatedDateCount++;
        }
      }

      // 写入更新后的内容
      if (updatedContent !== content) {
        fs.writeFileSync(mdFile, updatedContent, 'utf8');
        console.log(`已更新文件 ${path.relative(rootDir, mdFile)}`);
      }
    }
  }

  console.log(`检查完成，共更新了 ${updatedCount} 个文件的图片链接，${updatedDateCount} 个文件的修改日期`);
  return (updatedCount > 0 || updatedDateCount > 0);
}

// 检查文件是否需要更新 updated 字段
function checkAndUpdateModifiedDate(filePath, content) {
  try {
    // 获取文件的修改时间
    const stats = fs.statSync(filePath);
    const modifiedDate = new Date(stats.mtime);
    const modifiedDateStr = formatDate(modifiedDate);

    // 检查 frontmatter 中是否已有 updated 字段
    const updatedMatch = content.match(/updated:\s*(\d{4}-\d{2}-\d{2})/);

    // 如果没有 updated 字段，或者 updated 字段的值与文件修改时间不一致，则需要更新
    if (!updatedMatch) {
      // 检查是否有 published 字段，确保文件有 frontmatter
      const publishedMatch = content.match(/published:\s*(\d{4}-\d{2}-\d{2})/);
      if (publishedMatch) {
        return true;
      }
    } else {
      const currentUpdated = updatedMatch[1];
      if (currentUpdated !== modifiedDateStr) {
        return true;
      }
    }

    return false;
  } catch (err) {
    console.error(`检查文件修改日期时出错: ${err.message}`);
    return false;
  }
}

// 更新文件的 updated 字段
function updateModifiedDate(filePath, content) {
  try {
    // 获取文件的修改时间
    const stats = fs.statSync(filePath);
    const modifiedDate = new Date(stats.mtime);
    const modifiedDateStr = formatDate(modifiedDate);

    // 检查 frontmatter 中是否已有 updated 字段
    const updatedMatch = content.match(/updated:\s*(\d{4}-\d{2}-\d{2})/);

    if (updatedMatch) {
      // 替换现有的 updated 字段
      return content.replace(
        /updated:\s*(\d{4}-\d{2}-\d{2})/,
        `updated: ${modifiedDateStr}`
      );
    } else {
      // 在 published 字段后添加 updated 字段
      return content.replace(
        /(published:\s*\d{4}-\d{2}-\d{2})/,
        `$1\nupdated: ${modifiedDateStr}`
      );
    }
  } catch (err) {
    console.error(`更新文件修改日期时出错: ${err.message}`);
    return content;
  }
}

// 格式化日期为 yyyy-mm-dd
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 获取目录下的所有 Markdown 文件
function getAllMarkdownFiles(dir) {
  const files = fs.readdirSync(dir);
  let mdFiles = [];

  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      mdFiles = mdFiles.concat(getAllMarkdownFiles(filePath));
    } else if (file.endsWith('.md')) {
      mdFiles.push(filePath);
    }
  }

  return mdFiles;
}

// 检查内容中的图片路径
function checkImagePathsInContent(content, abbrlink) {
  const oldLinks = [];
  let needsUpdate = false;

  // 检查 Markdown 图片引用
  const mdImagePattern = /!\[.*?\]\(\/src\/assets\/images\/posts\/([^\/]+)\/([^)]+)\)/g;
  let mdMatch;
  while ((mdMatch = mdImagePattern.exec(content)) !== null) {
    const [fullMatch, imgAbbrlink, filename] = mdMatch;
    if (imgAbbrlink !== abbrlink) {
      oldLinks.push({ type: 'md', match: fullMatch, abbrlink: imgAbbrlink, filename });
      needsUpdate = true;
    }
  }

  // 检查 HTML img 标签
  const htmlImagePattern = /<img\s+[^>]*?src=["']\/src\/assets\/images\/posts\/([^\/]+)\/([^"']+)["'][^>]*?>/gi;
  let htmlMatch;
  while ((htmlMatch = htmlImagePattern.exec(content)) !== null) {
    const [fullMatch, imgAbbrlink, filename] = htmlMatch;
    if (imgAbbrlink !== abbrlink) {
      oldLinks.push({ type: 'html', match: fullMatch, abbrlink: imgAbbrlink, filename });
      needsUpdate = true;
    }
  }

  return { needsUpdate, oldLinks };
}

// 更新内容中的图片路径
function updateImagePaths(content, oldLinks, abbrlink) {
  let updatedContent = content;

  for (const link of oldLinks) {
    if (link.type === 'md') {
      // 更新 Markdown 图片引用
      const newLink = `![${getAltText(link.match)}](/src/assets/images/posts/${abbrlink}/${link.filename})`;
      updatedContent = updatedContent.replace(link.match, newLink);
    } else {
      // 更新 HTML img 标签
      const newLink = link.match.replace(
        /src=["']\/src\/assets\/images\/posts\/[^\/]+\/([^"']+)["']/i,
        `src="/src/assets/images/posts/${abbrlink}/$1"`
      );
      updatedContent = updatedContent.replace(link.match, newLink);
    }

    // 如果需要，移动图片文件
    moveImageFile(link.abbrlink, abbrlink, link.filename);
  }

  return updatedContent;
}

// 从 Markdown 图片引用中提取 alt 文本
function getAltText(mdImageTag) {
  const match = mdImageTag.match(/!\[(.*?)\]/);
  return match ? match[1] : '';
}

// 移动单个图片文件
function moveImageFile(oldAbbrlink, newAbbrlink, filename) {
  const oldImgPath = path.join(imagesDir, 'posts', oldAbbrlink, filename);
  const newImgDir = path.join(imagesDir, 'posts', newAbbrlink);
  const newImgPath = path.join(newImgDir, filename);

  // 如果源文件不存在，则跳过
  if (!fs.existsSync(oldImgPath)) {
    console.warn(`警告: 图片 ${oldImgPath} 不存在`);
    return;
  }

  // 确保目标目录存在
  if (!fs.existsSync(newImgDir)) {
    fs.mkdirSync(newImgDir, { recursive: true });
  }

  // 移动文件
  try {
    fs.copyFileSync(oldImgPath, newImgPath);
    fs.unlinkSync(oldImgPath);
    console.log(`已移动: ${path.relative(rootDir, oldImgPath)} -> ${path.relative(rootDir, newImgPath)}`);
  } catch (err) {
    console.error(`移动文件时出错: ${err.message}`);
  }
}

// 询问用户确认
async function confirmAction(prompt) {
  process.stdout.write(prompt);

  return new Promise(resolve => {
    process.stdin.once('data', data => {
      const answer = data.toString().trim().toLowerCase();
      resolve(answer === 'y' || answer === 'yes');
    });
  });
}

// 显示帮助信息
function showHelp(command) {
  if (command === 'add') {
    console.log(`
使用方法: pnpm copy-posts add [选项] <源文件路径> [子目录] [标签1,标签2,...]

选项:
  --source, -s, --file <文件路径>  要复制的 Markdown 文件的路径
  --dir, -d <目录名>              在 src/content/posts/ 下的子目录名，默认使用文件创建日期的 yyyy/mm 格式
  --tags, -t <标签1,标签2,...>     文章标签，默认为"未分类"
  --title <标题>                  文章标题，默认使用一级标题或文件名
  --date <日期>                   发布日期 (yyyy-mm-dd)，默认使用文件创建日期
  --toc <true|false>              是否生成目录，默认为 true
  --lang <语言>                   文章语言，默认为 zh
  --abbrlink, -a, --link <链接>   自定义文章短链接，默认自动生成
  --skip-formatting <true|false>  是否跳过格式处理，默认为 false
  --help, -h                      显示帮助信息

说明:
  'add' 命令用于将 Markdown 文件复制到博客目录，添加必要的 frontmatter，
  并自动处理本地图片（复制图片文件并更新引用路径）。

示例:
  pnpm copy-posts add ./my-post.md
  pnpm copy-posts add ./my-post.md tech javascript,tutorial
  pnpm copy-posts add --file ./my-post.md --dir tech --tags javascript,tutorial
  pnpm copy-posts add -s ./my-post.md -d tech -t javascript,tutorial
    `);
  } else if (command === 'update') {
    console.log(`
使用方法: pnpm copy-posts update [选项] <文件路径>

选项:
  --source, -s, --file <文件路径>  要更新的 Markdown 文件的路径
  --abbrlink, -a, --link <链接>    新的文章短链接
  --old-abbrlink, -o, --old <链接> 原文章短链接（如不指定，将自动从文件中提取）
  --force, -f                     强制执行，不询问确认
  --help, -h                      显示帮助信息

说明:
  'update' 命令用于更新文章的 abbrlink，并自动更新文章中的图片链接路径，
  同时移动相应的图片文件。如果不指定旧的 abbrlink，脚本会尝试从文件中提取。

示例:
  pnpm copy-posts update ./post.md --abbrlink new-link
  pnpm copy-posts update -s ./post.md -a new-link -o old-link
  pnpm copy-posts update ./post.md --link new-link --force
    `);
  } else if (command === 'check') {
    console.log(`
使用方法: pnpm copy-posts check [选项]

选项:
  --source, -s, --file <文件路径>  要检查的特定 Markdown 文件路径（如不指定，检查所有文件）
  --force, -f                     强制执行修复，不询问确认
  --help, -h                      显示帮助信息

说明:
  'check' 命令会执行以下检查:
  1. 检查 Markdown 文件中的图片链接，确保它们使用了与文章 abbrlink 相同的路径。
     如发现不匹配，可以自动修复图片链接并移动相应的图片文件。
  2. 检查文件是否有修改，如有修改则更新 frontmatter 中的 updated 字段。
     如果 frontmatter 中没有 updated 字段，则会添加该字段。

  不指定特定文件时，将检查 src/content/posts 目录下的所有 Markdown 文件。

示例:
  pnpm copy-posts check
  pnpm copy-posts check --file ./src/content/posts/tech/my-post.md
  pnpm copy-posts check -s ./src/content/posts/tech/my-post.md -f
    `);
  } else if (command === 'cleanup') {
    console.log(`
使用方法: pnpm copy-posts cleanup [选项]

选项:
  --force, -f                     强制执行，不询问确认
  --help, -h                      显示帮助信息

说明:
  'cleanup' 命令用于清理未被引用的图片，删除那些没有在 Markdown 文件中被引用的图片文件。

示例:
  pnpm copy-posts cleanup
    `);
  } else {
    console.log(`
使用方法: pnpm copy-posts <命令> [选项]

命令:
  add      添加新文章                       pnpm copy-posts add ./my-post.md
  update   更新文章 abbrlink 并同步图片链接   pnpm copy-posts update ./post.md -a new-link
  check    检查并修复图片链接                pnpm copy-posts check
  cleanup  清理未引用的图片                  pnpm copy-posts cleanup

公共选项:
  --help, -h    显示帮助信息
  --force, -f   强制执行，不询问确认

使用 'pnpm copy-posts <命令> --help' 获取各命令的详细帮助。
    `);
  }
}

// 处理文件
function processMarkdownFile(options) {
  try {
    const {
      sourcePath,
      subdirectory,
      tags = [],
      title: customTitle = null,
      published: customPublished = null,
      toc = true,
      lang = 'zh',
      abbrlink: customAbbrlink = null,
      oldAbbrlink = null,
      updateImageLinks: shouldUpdateImageLinks = false,
      skipFormatting = false
    } = options;

    // 检查源文件是否存在
    if (!fs.existsSync(sourcePath)) {
      console.error(`错误: 源文件 ${sourcePath} 不存在`);
      return false;
    }

    // 读取文件内容
    let content = fs.readFileSync(sourcePath, 'utf8');

    // 处理Markdown内容，替换特定语法
    content = processMarkdownContent(content, skipFormatting);

    // 检查文件是否已经有 frontmatter
    const hasFrontmatter = content.startsWith('---');
    let processedContent = content;
    let finalAbbrlink = customAbbrlink;

    if (hasFrontmatter) {
      // 从现有 frontmatter 中提取 abbrlink
      const abbrMatch = content.match(/abbrlink:\s*([^\s\n]+)/);
      const existingAbbrlink = abbrMatch ? abbrMatch[1] : null;

      // 如果没有指定自定义 abbrlink，但文件中存在 abbrlink，则使用现有的
      if (!finalAbbrlink && existingAbbrlink) {
        finalAbbrlink = existingAbbrlink;
      }

      // 如果指定了 abbrlink 并且与现有的不同，则更新 frontmatter
      if (finalAbbrlink && existingAbbrlink && finalAbbrlink !== existingAbbrlink) {
        processedContent = processedContent.replace(
          new RegExp(`abbrlink:\\s*${existingAbbrlink}`, 'g'),
          `abbrlink: ${finalAbbrlink}`
        );
        console.log(`已更新 frontmatter 中的 abbrlink: ${existingAbbrlink} -> ${finalAbbrlink}`);
      }

      // 如果需要更新图片链接
      if (shouldUpdateImageLinks && oldAbbrlink && finalAbbrlink) {
        processedContent = updateImageLinks(processedContent, oldAbbrlink, finalAbbrlink);
      }

      // 如果指定了自定义 abbrlink，但没有指定 oldAbbrlink，则尝试使用现有的 abbrlink 作为 oldAbbrlink
      if (shouldUpdateImageLinks && finalAbbrlink && !oldAbbrlink && existingAbbrlink) {
        processedContent = updateImageLinks(processedContent, existingAbbrlink, finalAbbrlink);
      }
    } else {
      // 获取文件名作为备用标题
      const fileName = path.basename(sourcePath, '.md');

      // 尝试从内容中获取第一个 h1 标题
      const autoTitle = getFirstH1Title(content) || fileName;
      const title = customTitle || autoTitle;

      // 生成 abbrlink
      const autoAbbrlink = generateAbbrlink(content);
      finalAbbrlink = customAbbrlink || autoAbbrlink;

      // 处理文章中的本地图片
      const { content: contentWithProcessedImages, imageCount } = processImages(content, sourcePath, finalAbbrlink);
      content = contentWithProcessedImages;

      if (imageCount > 0) {
        console.log(`处理了 ${imageCount} 张本地图片`);
      }

      // 获取文件创建日期
      const autoPublished = getFileCreationDate(sourcePath);
      const published = customPublished || autoPublished;

      // 获取文件修改日期作为 updated 字段
      const updated = formatDate(new Date(fs.statSync(sourcePath).mtime));

      // 如果没有指定标签，添加一个默认标签
      const finalTags = tags.length > 0 ? tags : ['未分类'];

      // 构建 frontmatter
      const frontmatter = `---
title: ${title}
published: ${published}
updated: ${updated}
tags:
${finalTags.map(tag => `  - ${tag}`).join('\n')}
toc: ${toc}
lang: ${lang}
abbrlink: ${finalAbbrlink}
---

`;

      // 添加 frontmatter 到内容前面
      processedContent = frontmatter + content;
    }

    // 创建目标目录
    const targetDir = path.join(postsDir, subdirectory);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // 获取目标文件路径
    const targetPath = path.join(targetDir, path.basename(sourcePath));

    // 写入文件
    fs.writeFileSync(targetPath, processedContent, 'utf8');

    console.log(`成功: 文件已复制到 ${targetPath}`);
    return true;
  } catch (error) {
    console.error(`处理文件时出错: ${error.message}`);
    return false;
  }
}

// 更新图片链接
function updateImageLinks(content, oldAbbrlink, newAbbrlink) {
  if (!oldAbbrlink || !newAbbrlink || oldAbbrlink === newAbbrlink) {
    return content;
  }

  console.log(`更新图片链接: ${oldAbbrlink} -> ${newAbbrlink}`);

  let updatedContent = content;
  let replacementCount = 0;

  // 更新 Markdown 图片引用
  const mdImagePattern = new RegExp(`!\\[([^\\]]*)\\]\\(/src/assets/images/posts/${oldAbbrlink}/([^)]+)\\)`, 'g');
  updatedContent = updatedContent.replace(mdImagePattern, (match, alt, filename) => {
    replacementCount++;
    return `![${alt}](/src/assets/images/posts/${newAbbrlink}/${filename})`;
  });

  // 更新 HTML img 标签
  const htmlImagePattern = new RegExp(`<img([^>]*)src=["']/src/assets/images/posts/${oldAbbrlink}/([^"']+)["']([^>]*)>`, 'g');
  updatedContent = updatedContent.replace(htmlImagePattern, (match, before, filename, after) => {
    replacementCount++;
    return `<img${before}src="/src/assets/images/posts/${newAbbrlink}/${filename}"${after}>`;
  });

  if (replacementCount > 0) {
    console.log(`已更新 ${replacementCount} 个图片链接`);
  } else {
    console.log('没有找到需要更新的图片链接');
  }

  // 同时需要移动图片文件
  moveImageFiles(oldAbbrlink, newAbbrlink);

  return updatedContent;
}

// 移动图片文件
function moveImageFiles(oldAbbrlink, newAbbrlink) {
  const oldImgDir = path.join(imagesDir, 'posts', oldAbbrlink);
  const newImgDir = path.join(imagesDir, 'posts', newAbbrlink);

  // 检查旧目录是否存在
  if (!fs.existsSync(oldImgDir)) {
    console.log(`旧图片目录不存在: ${oldImgDir}`);
    return;
  }

  // 确保新目录存在
  if (!fs.existsSync(newImgDir)) {
    fs.mkdirSync(newImgDir, { recursive: true });
  }

  // 获取旧目录中的所有文件
  const files = fs.readdirSync(oldImgDir);

  if (files.length === 0) {
    console.log('没有找到需要移动的图片文件');
    return;
  }

  console.log(`移动 ${files.length} 个图片文件`);

  // 移动每个文件
  for (const file of files) {
    const oldPath = path.join(oldImgDir, file);
    let newFileName = file;

    // 可选：重命名文件，替换文件名中的 abbrlink 前缀
    if (file.startsWith(oldAbbrlink)) {
      newFileName = file.replace(oldAbbrlink, newAbbrlink);
    }

    const newPath = path.join(newImgDir, newFileName);

    try {
      fs.copyFileSync(oldPath, newPath);
      fs.unlinkSync(oldPath);
      console.log(`已移动: ${oldPath} -> ${newPath}`);
    } catch (err) {
      console.error(`移动文件时出错: ${err.message}`);
    }
  }

  // 删除旧目录（如果为空）
  try {
    const remainingFiles = fs.readdirSync(oldImgDir);
    if (remainingFiles.length === 0) {
      fs.rmdirSync(oldImgDir);
      console.log(`已删除空目录: ${path.relative(rootDir, oldImgDir)}`);
    }
  } catch (err) {
    console.error(`删除目录时出错: ${err.message}`);
  }
}

// 清理未引用的图片
async function cleanupImages(options) {
  const dryRun = !options.force; // 如果没有 --force，则为干运行模式
  const verbose = options.verbose || false;

  console.log('开始检查未引用的图片...');

  // 1. 获取所有 Markdown 文件
  console.log('获取所有 Markdown 文件...');
  const mdFiles = getAllMarkdownFiles(postsDir);
  console.log(`找到 ${mdFiles.length} 个 Markdown 文件`);

  // 2. 从所有 Markdown 文件中提取图片引用
  console.log('提取所有图片引用...');
  const referencedImages = new Set();

  for (const mdFile of mdFiles) {
    const content = fs.readFileSync(mdFile, 'utf8');
    const imageRefs = extractImageRefs(content);

    if (verbose && imageRefs.size > 0) {
      console.log(`在 ${path.relative(rootDir, mdFile)} 中找到 ${imageRefs.size} 个图片引用`);
    }

    imageRefs.forEach(ref => {
      // 转换为系统路径
      let imagePath = ref;
      if (imagePath.startsWith('/')) {
        imagePath = imagePath.substring(1);
      }
      imagePath = path.join(rootDir, imagePath);
      referencedImages.add(path.normalize(imagePath));
    });
  }

  console.log(`找到 ${referencedImages.size} 个被引用的图片`);

  // 3. 获取所有图片文件
  const imagesBaseDir = path.join(imagesDir, 'posts');
  if (!fs.existsSync(imagesBaseDir)) {
    console.log('图片目录不存在，没有需要清理的图片');
    return { total: 0, unreferenced: 0, deleted: 0 };
  }

  console.log('获取所有图片文件...');
  const imageFiles = getAllFiles(imagesBaseDir);
  console.log(`找到 ${imageFiles.length} 个图片文件`);

  // 4. 找出未被引用的图片
  const unreferencedImages = imageFiles.filter(imgFile => {
    const normalizedPath = path.normalize(imgFile);
    return !referencedImages.has(normalizedPath);
  });

  console.log(`找到 ${unreferencedImages.length} 个未引用的图片`);

  // 5. 删除未引用的图片（如果不是干运行模式）
  let deletedCount = 0;

  if (unreferencedImages.length > 0) {
    if (dryRun) {
      console.log('干运行模式: 不会删除任何文件');
      console.log('以下是未引用的图片列表:');
      unreferencedImages.forEach(img => {
        console.log(`- ${path.relative(rootDir, img)}`);
      });

      if (await confirmAction('是否删除这些未引用的图片？(y/N) ')) {
        await deleteUnreferencedImages(unreferencedImages, verbose);
        deletedCount = unreferencedImages.length;
      }
    } else {
      console.log('正在删除未引用的图片...');
      deletedCount = await deleteUnreferencedImages(unreferencedImages, verbose);
    }
  } else {
    console.log('没有找到未引用的图片，无需清理');
  }

  return {
    total: imageFiles.length,
    unreferenced: unreferencedImages.length,
    deleted: deletedCount
  };
}

// 删除未引用的图片
async function deleteUnreferencedImages(images, verbose) {
  let deletedCount = 0;

  for (const img of images) {
    try {
      fs.unlinkSync(img);
      deletedCount++;
      if (verbose) {
        console.log(`已删除: ${path.relative(rootDir, img)}`);
      }
    } catch (err) {
      console.error(`删除 ${img} 时出错: ${err.message}`);
    }
  }

  console.log(`已删除 ${deletedCount} 个未引用的图片`);

  // 清理空目录
  await cleanupEmptyDirs(path.join(imagesDir, 'posts'));

  return deletedCount;
}

// 从 Markdown 文件中提取图片引用
function extractImageRefs(content) {
  const imageRefs = new Set();

  // 提取 Markdown 图片引用
  const mdImagePattern = /!\[.*?\]\(([^)]+)\)/g;
  let mdMatch;
  while ((mdMatch = mdImagePattern.exec(content)) !== null) {
    const imgPath = mdMatch[1];
    if (imgPath.includes('/src/assets/images/posts/')) {
      imageRefs.add(imgPath);
    }
  }

  // 提取 HTML img 标签
  const htmlImagePattern = /<img\s+[^>]*?src=["']([^"']+)["'][^>]*?>/gi;
  let htmlMatch;
  while ((htmlMatch = htmlImagePattern.exec(content)) !== null) {
    const imgPath = htmlMatch[1];
    if (imgPath.includes('/src/assets/images/posts/')) {
      imageRefs.add(imgPath);
    }
  }

  return imageRefs;
}

// 递归获取目录下的所有文件
function getAllFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      getAllFiles(filePath, fileList);
    } else {
      fileList.push(filePath);
    }
  });

  return fileList;
}

// 清理空目录
async function cleanupEmptyDirs(dir) {
  const items = fs.readdirSync(dir);

  for (const item of items) {
    const itemPath = path.join(dir, item);
    if (fs.statSync(itemPath).isDirectory()) {
      await cleanupEmptyDirs(itemPath);

      // 检查目录是否为空
      const files = fs.readdirSync(itemPath);
      if (files.length === 0) {
        fs.rmdirSync(itemPath);
        console.log(`已删除空目录: ${path.relative(rootDir, itemPath)}`);
      }
    }
  }
}

main();
