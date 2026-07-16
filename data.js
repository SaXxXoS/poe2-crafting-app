window.EXILEFORGE_DATA = {
  classOptions: {
    weapon: ['Speer','Bogen','Kampfstab','Armbrust','Streitkolben','Schwert','Axt','Dolch','Flegel'],
    armour: ['Helm','Körperrüstung','Handschuhe','Stiefel','Schild','Fokus'],
    jewellery: ['Ring','Amulett','Gürtel']
  },

  baseItems: {
    Speer: [
      {
        id:'flying-spear',
        name:'Fliegender Speer',
        requiredLevel:78,
        requirements:'50 Str · 127 Ges',
        physical:'46–77',
        crit:'5,00 %',
        aps:'1,60',
        implicits:[
          {name:'Gewährt Fertigkeit: Speerwurf',kind:'Gewährte Fertigkeit'},
          {name:'25–35 % erhöhte Projektilgeschwindigkeit mit dieser Waffe',kind:'Variabler Basis-Implizit'}
        ]
      },
      {
        id:'war-spear',
        name:'Kriegsspeer',
        requiredLevel:21,
        requirements:'14 Str · 31 Ges',
        physical:'16–27',
        crit:'5,00 %',
        aps:'1,60',
        implicits:[
          {name:'Gewährt Fertigkeit: Speerwurf',kind:'Gewährte Fertigkeit'},
          {name:'25–35 % erhöhte Projektilgeschwindigkeit mit dieser Waffe',kind:'Variabler Basis-Implizit'}
        ]
      },
      {
        id:'hunting-spear',
        name:'Jagdspeer',
        requiredLevel:10,
        requirements:'9 Str · 17 Ges',
        physical:'10–17',
        crit:'5,00 %',
        aps:'1,55',
        implicits:[
          {name:'Gewährt Fertigkeit: Speerwurf',kind:'Gewährte Fertigkeit'},
          {name:'15–25 % Chance, bei Treffer zu verstümmeln',kind:'Variabler Basis-Implizit'}
        ]
      },
      {
        id:'ironhead-spear',
        name:'Eisenkopf-Speer',
        requiredLevel:5,
        requirements:'10 Ges',
        physical:'9–12',
        crit:'5,00 %',
        aps:'1,60',
        implicits:[
          {name:'Gewährt Fertigkeit: Speerwurf',kind:'Gewährte Fertigkeit'}
        ]
      }
    ],
    Bogen:[],Kampfstab:[],Armbrust:[],Streitkolben:[],Schwert:[],Axt:[],Dolch:[],Flegel:[],
    Helm:[],Körperrüstung:[],Handschuhe:[],Stiefel:[],Schild:[],Fokus:[],
    Ring:[],Amulett:[],Gürtel:[]
  },

  mods: {
    Speer: {
      prefix: [
        {id:'phys-t1',name:'Erhöhter physischer Schaden',group:'phys_percent',lvl:81,tier:'T1',range:'170–179 %'},
        {id:'phys-t2',name:'Erhöhter physischer Schaden',group:'phys_percent',lvl:72,tier:'T2',range:'155–169 %'},
        {id:'flat-phys-t1',name:'Fügt physischen Schaden hinzu',group:'flat_phys',lvl:78,tier:'T1',range:'26–35 bis 52–78'},
        {id:'phys-accuracy-t1',name:'Erhöhter physischer Schaden und Genauigkeit',group:'phys_hybrid',lvl:80,tier:'T1',range:'90–99 % / +181–220 Genauigkeit'},
        {id:'cold-t1',name:'Fügt Kälteschaden hinzu',group:'flat_cold',lvl:75,tier:'T1',range:'24–38 bis 47–69'},
        {id:'lightning-t1',name:'Fügt Blitzschaden hinzu',group:'flat_lightning',lvl:75,tier:'T1',range:'8–16 bis 78–96'}
      ],
      suffix: [
        {id:'proj-4',name:'+4 zu Stufen aller Projektilfertigkeiten',group:'projectile_skills',lvl:81,tier:'T1',range:'+4'},
        {id:'proj-3',name:'+3 zu Stufen aller Projektilfertigkeiten',group:'projectile_skills',lvl:55,tier:'T2',range:'+3'},
        {id:'melee-4',name:'+4 zu Stufen aller Nahkampffertigkeiten',group:'melee_skills',lvl:81,tier:'T1',range:'+4'},
        {id:'speed-t1',name:'Erhöhte Angriffsgeschwindigkeit',group:'attack_speed',lvl:78,tier:'T1',range:'16–19 %'},
        {id:'crit-t1',name:'Erhöhte kritische Trefferchance',group:'crit_chance',lvl:78,tier:'T1',range:'35–39 %'},
        {id:'stun-t1',name:'Erhöhter Betäubungsaufbau',group:'stun_buildup',lvl:80,tier:'T1',range:'71–80 %'}
      ]
    }
  },

  priceItems: [
    'Divine Orb','Exalted Orb','Regal Orb','Orb of Annulment',
    'Chaos Orb','Essence (Beispiel)','Omen (Beispiel)'
  ]
};
