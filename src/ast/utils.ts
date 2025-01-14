import typescript, { forEachChild } from 'typescript';
import fs from 'fs';
import path from 'path';

import {
  Project,
  Node,
  TypeReferenceNode,
  SourceFile,
  QualifiedName,
  TypeAliasDeclarationStructure,
} from 'ts-morph';
import { SyntaxKind } from '@ts-morph/common';
import { cloneDeep, find, findIndex, remove } from 'lodash';

export function getTypesFromDeclare(source: SourceFile) {
  const getTypeReferenceName = (typeReference: TypeReferenceNode) => {
    const qn = typeReference.getFirstChildIfKind(SyntaxKind.QualifiedName);

    if (Node.isQualifiedName(qn)) {
      // debugger;
      return qn.getRight().getText();
    } else {
      return undefined;
    }
  };

  const typeNames = source
    .getModules()
    .map((md) => md.getTypeAliases().map((ta) => ta.getName()))
    .flat();

  return typeNames;
}

export function getTypesFormController(source: SourceFile) {
  const getTypeReferenceName = (typeReference: TypeReferenceNode) => {
    let qn: QualifiedName;
    try {
      qn = typeReference.getFirstChildIfKind(SyntaxKind.QualifiedName);
    } catch {
      return undefined;
    }

    if (Node.isQualifiedName(qn)) {
      return qn.getRight().getText();
    } else {
      return undefined;
    }
  };

  const typeNames = source
    .getFunctions()
    .map((funcNode) => {
      const paramsTypeReference = funcNode
        .getParameters()
        .map((param) => {
          return [
            ...param.getChildrenOfKind(SyntaxKind.TypeReference).map(getTypeReferenceName),
            ...param
              .getChildrenOfKind(SyntaxKind.ArrayType)
              .map((at) => at.getChildrenOfKind(SyntaxKind.TypeReference).map(getTypeReferenceName))
              .flat(),
          ];
        })
        .flat(2);
      let callTypeReference: TypeReferenceNode;
      try {
        callTypeReference = funcNode
          .getStatementByKind(SyntaxKind.ReturnStatement)
          .getChildAtIndexIfKindOrThrow(1, SyntaxKind.CallExpression)
          .getFirstChildByKindOrThrow(SyntaxKind.TypeReference);
      } catch {
        try {
          callTypeReference = funcNode
            .getStatementByKind(SyntaxKind.ReturnStatement)
            .getFirstChildByKindOrThrow(SyntaxKind.CallExpression)
            .getFirstChildByKindOrThrow(SyntaxKind.ArrayType)
            .getFirstChildByKindOrThrow(SyntaxKind.TypeReference);
        } catch {}
      }
      const callTypeName = getTypeReferenceName(callTypeReference);
      // .getChildrenOfKind(SyntaxKind.CallExpression)
      // .map((call) =>
      //   call.getChildrenOfKind(SyntaxKind.TypeReference).map((tr) => tr.getKindName()),
      // );

      return [...paramsTypeReference, callTypeName];
    })
    .flat();

  return [...new Set(typeNames.filter((x) => !!x))];
}

export function getControllerTypesDep(controllerSource: SourceFile, typeSource: SourceFile) {
  const controllerTypes = getTypesFormController(controllerSource);

  const module = typeSource.getStatementByKind(SyntaxKind.ModuleDeclaration);

  const depTypes: string[] = [...controllerTypes];
  const getTypeReferenceDeps = (typeName: string) => {
    const ta = module.getTypeAlias(typeName);

    try {
      const typeReferences = ta
        .getChildAtIndexIfKind(3, SyntaxKind.TypeLiteral)
        .getChildAtIndexIfKind(1, SyntaxKind.SyntaxList)
        .getChildrenOfKind(SyntaxKind.PropertySignature)
        .map((ps) => [
          ...ps.getChildrenOfKind(SyntaxKind.TypeReference).map((tr) => tr.getText()),
          ...ps
            .getChildrenOfKind(SyntaxKind.ArrayType)
            .map((at) => at.getChildrenOfKind(SyntaxKind.TypeReference).map((tr) => tr.getText()))
            .flat(),
        ])
        .flat();

      const nonInDepTypes = typeReferences.filter((tr) => !depTypes.includes(tr));

      depTypes.push(...nonInDepTypes);

      nonInDepTypes.forEach((trName) => getTypeReferenceDeps(trName));
    } catch {}
  };

  controllerTypes.forEach((typeName) => getTypeReferenceDeps(typeName));

  return [...new Set(depTypes)];
}

export function resolveControllerNames(indexSource?: SourceFile) {
  return indexSource.getImportDeclarations().map((id) => {
    const name = id.getNamespaceImport().getText();
    return {
      fileName: name,
      controllerName: name,
    };
  });
}

export function addBlankLineForNodes(parentNode: Node) {
  const nodes = parentNode.forEachChildAsArray();

  nodes.forEach((node) => {
    node.appendWhitespace((writer) => writer.newLine());
  });
}

export function replaceExistStatements(
  oldStatements: TypeAliasDeclarationStructure[],
  existStatements: TypeAliasDeclarationStructure[],
): TypeAliasDeclarationStructure[] {

  const replacedStatements: TypeAliasDeclarationStructure[] = [];

  for (let i = 0; i < existStatements.length; i++) {
    const oldStatementIndex = findIndex(
      oldStatements,
      (item) => item.name === existStatements[i].name,
    );

    if (
      (oldStatements[oldStatementIndex].type as string).replace(/[ ]|[\r\n]|[\n]|[;]/g, '') !==
      (existStatements[i].type as string).replace(/[ ]|[']|[\r\n]|[\n]|[;]/g, '')
    ) {
      oldStatements[oldStatementIndex].type = existStatements[i].type;

      replacedStatements.push({ ...existStatements[i] });
    }

  }

  return replacedStatements;
}

export function mergeStatementBy<T = any>(
  oldArray: T[],
  newArray: T[],
  predicate: (preOldItem: T, curOldItem: T, newItem: T, oldArrayIndex: number) => boolean,
) {
  const o = cloneDeep(oldArray);
  const n = cloneDeep(newArray);
  for (let i = 0; i < o.length; i++) {
    for (let j = 0; j < n.length; ) {
      if (predicate(o[i - 1], o[i], n[j], i)) {
        o.splice(i, 0, n[j]);

        n.splice(j, 1);
      } else {
        j++;
      }
    }

    if (n.length === 0) {
      break;
    }
  }

  if (n.length > 0) {
    return [...o, ...n];
  } else {
    return o;
  }
}
