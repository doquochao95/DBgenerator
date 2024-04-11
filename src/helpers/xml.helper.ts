import { xml2js } from '../_core/xml2js';
import { Project, PackageDetail, Element, ItemGroup } from '../common';

export function getPackages(xml: string, project: Project): PackageDetail[] {
  let packageList: PackageDetail[] = [];
  let itemGroup = getItemGroupIndexResult(xml);
  if (itemGroup.itemGroupIndex !== -1) {
    checkMoreThenOneItemGroup(itemGroup.projectElement, project);
    let selectedItemGroup: Element =
      itemGroup.projectElement.elements[itemGroup.itemGroupIndex];
    let packages: Element[] = getPackageReferences(selectedItemGroup);
    packageList = packages.map(e => {
      let attr = e.attributes;
      let result: PackageDetail = {
        packageName: attr['Include'],
        packageVersion: attr['Version'],
      };
      return result;
    });
  }
  return packageList;
}
function getItemGroupIndexResult(xml: string): ItemGroup {
  let rootObj: Element = xmlToObject(xml);
  let projectIndex: number = getProjectIndex(rootObj);
  let projectElement: Element = rootObj.elements[projectIndex];
  let groupItemIndex: number = getItemGroupIndex(projectElement);
  return {
    rootElement: rootObj,
    itemGroupIndex: groupItemIndex,
    projectElement: projectElement,
  };
}
function xmlToObject(xml: string): any {
  return xml2js(xml, { captureSpacesBetweenElements: true });
}

function getProjectIndex(elm: Element): number {
  let index: number = elm.elements.findIndex(
    x => x.name == 'Project' && x.type == 'element'
  );

  return index;
}
function getItemGroupIndex(elm: Element): number {
  let newElm: number = elm.elements?.findIndex(
    x =>
      x.name == 'ItemGroup' &&
      x.type == 'element' &&
      x.elements &&
      x.elements.length > 0 &&
      x.elements.find(
        z => z.name == 'PackageReference' && z.type == 'element'
      ) !== undefined
  );

  return newElm ?? -1;
}
function checkMoreThenOneItemGroup(elm: Element, project: Project): Element[] {
  let newElm: Element[] = elm.elements.filter(
    x =>
      x.name == 'ItemGroup' &&
      x.type == 'element' &&
      x.elements &&
      x.elements.length > 0 &&
      x.elements.find(
        z => z.name == 'PackageReference' && z.type == 'element'
      ) !== undefined
  );
  if (newElm && newElm.length > 1) {
    throw `More than one <ItemGroup> find. ${project.projectName} | ${project.projectPath}`;
  }
  return newElm;
}
function getPackageReferences(elm: Element): Element[] {
  let index: Element[] = elm.elements.filter(
    x => x.name == 'PackageReference' && x.type == 'element'
  );
  return index;
}